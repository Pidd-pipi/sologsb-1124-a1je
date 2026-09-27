/**
 * 邮戳合并与恢复：全部在单个 IndexedDB 读写事务内完成，
 * 任一写入失败（含抛错中止事务），邮戳与所有实寄封都回到操作前的状态。
 */
import { db } from '@/utils/db'
import { nowIso } from '@/utils/id'
import type { CancelTrace } from '@/types/cover'
import type { Postmark } from '@/types/postmark'

export interface MergeResult {
  /** 实际改挂到保留戳的封数（已含保留戳的封只去重，不计入） */
  rehookedCoverCount: number
  /** 仅摘掉重复登记的封数 */
  dedupCoverCount: number
  duplicate: Postmark
  keep: Postmark
}

/**
 * 把重复戳并入保留戳：
 * 1. 重复戳关联的实寄封全部改挂保留戳；同一封已有关联时不重复登记；
 * 2. 每封留下原编号与并入去向的痕迹；
 * 3. 重复戳置为停用并记录并入去向（记录与原编号仍保留在目录中）。
 */
export async function mergePostmarks(
  keepId: number,
  duplicateId: number
): Promise<MergeResult> {
  if (keepId === duplicateId) {
    throw new Error('保留戳与重复戳不能是同一枚邮戳')
  }

  let result: MergeResult | null = null

  await db.transaction('rw', db.postmarks, db.covers, async () => {
    const keep = await db.postmarks.get(keepId)
    const duplicate = await db.postmarks.get(duplicateId)
    if (!keep) throw new Error('未找到保留戳，可能已被删除')
    if (!duplicate) throw new Error('未找到重复戳，可能已被删除')
    if (keep.status === 'inactive') {
      throw new Error('保留戳已停用，不能并入；请先恢复该戳')
    }
    if (duplicate.status === 'inactive') {
      throw new Error('重复戳已停用，不能再次合并')
    }

    const ts = nowIso()
    let rehooked = 0
    let dedup = 0

    // 只处理仍挂着重复戳的封；cancelPmIds 中的重复 id 全部清理后再按情况补挂。
    // cancelPmIds 是数组字段、未建索引，在全表 modify 内按内容过滤。
    await db.covers.toCollection().modify((cover) => {
      const ids: number[] = Array.isArray(cover.cancelPmIds) ? cover.cancelPmIds : []
      const occurrences = ids.filter((v) => v === duplicateId).length
      if (!occurrences) return
      const hadKeep = ids.includes(keepId)
      const nextIds = ids.filter((v) => v !== duplicateId)
      if (!hadKeep) nextIds.push(keepId)

      cover.cancelPmIds = nextIds
      if (!Array.isArray(cover.cancelTraces)) cover.cancelTraces = []
      // 同编号痕迹只登记一次，避免重复合并产生多条
      if (!cover.cancelTraces.some((t: CancelTrace) => t.fromPmId === duplicateId)) {
        cover.cancelTraces.push({
          fromPmId: duplicateId,
          fromPmNo: duplicate.pmNo,
          currentPmId: keepId,
          hadKeep,
          mergedAt: ts
        })
      }
      cover.updatedAt = ts

      if (hadKeep) dedup += 1
      else rehooked += 1
    })

    await db.postmarks.update(duplicateId, {
      status: 'inactive',
      mergedIntoPmId: keepId,
      mergedAt: ts,
      updatedAt: ts
    })
    await db.postmarks.update(keepId, { updatedAt: ts })

    result = {
      rehookedCoverCount: rehooked,
      dedupCoverCount: dedup,
      duplicate,
      keep
    }
  })

  if (!result) throw new Error('合并失败：数据未改动')
  return result
}

/**
 * 恢复一枚因合并停用的邮戳：
 * 按当时留下的痕迹逐封还原销票关系（原本就挂着保留戳的封只摘重复登记，不摘保留戳），
 * 清除并入去向并重新启用。合并后若保留戳被删除，痕迹仍可据原编号还原挂回该戳。
 */
export async function reactivatePostmark(postmarkId: number): Promise<number> {
  let affected = 0

  await db.transaction('rw', db.postmarks, db.covers, async () => {
    const pm = await db.postmarks.get(postmarkId)
    if (!pm) throw new Error('未找到该邮戳，可能已被删除')
    if (pm.status !== 'inactive') throw new Error('该邮戳正在使用，无需恢复')

    const ts = nowIso()

    await db.covers.toCollection().modify((cover) => {
      if (!Array.isArray(cover.cancelTraces) || !cover.cancelTraces.length) return
      const own = cover.cancelTraces.filter((t: CancelTrace) => t.fromPmId === postmarkId)
      if (!own.length) return

      const ids: number[] = Array.isArray(cover.cancelPmIds) ? cover.cancelPmIds : []
      let changed = false
      for (const trace of own) {
        if (!ids.includes(postmarkId)) {
          ids.push(postmarkId)
          changed = true
        }
        // 合并时该封没有保留戳（是新挂上去的），恢复时摘掉保留戳；
        // 原本就有的保留戳关系不动。（防御性清理多次出现的情况）
        if (!trace.hadKeep) {
          let idx = ids.lastIndexOf(trace.currentPmId)
          while (idx >= 0) {
            ids.splice(idx, 1)
            changed = true
            idx = ids.lastIndexOf(trace.currentPmId)
          }
        }
      }
      if (changed) cover.cancelPmIds = ids
      cover.cancelTraces = cover.cancelTraces.filter(
        (t: CancelTrace) => t.fromPmId !== postmarkId
      )
      cover.updatedAt = ts
      affected += 1
    })

    await db.postmarks.update(postmarkId, {
      status: 'active',
      mergedIntoPmId: null,
      mergedAt: '',
      updatedAt: ts
    })
  })

  return affected
}
