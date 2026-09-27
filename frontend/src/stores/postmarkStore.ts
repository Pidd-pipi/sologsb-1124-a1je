import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, saveAsset } from '@/utils/db'
import type { Postmark, PostmarkStatus } from '@/types/postmark'
import { nextSerialNo, nowIso } from '@/utils/id'

export interface ImagePayload {
  dataUrl: string
  fileName: string
}

/** 合并结果：moved 实际改挂的封数；skipped 本已挂保留戳、未重复登记的封数 */
export interface MergePostmarkResult {
  moved: number
  skipped: number
}

export const usePostmarkStore = defineStore('postmark', () => {
  const list = ref<Postmark[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      list.value = await db.postmarks.orderBy('pmNo').toArray()
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /** 生成下一个编目号，如 PM-0007 */
  function nextPmNo(): string {
    return nextSerialNo('PM-', list.value.map((p) => p.pmNo))
  }

  async function create(input: Postmark, image?: ImagePayload | null): Promise<number> {
    const now = nowIso()
    const record: Postmark = {
      ...input,
      pmNo: input.pmNo || nextPmNo(),
      lettering: { ...input.lettering },
      status: 'active',
      mergedIntoId: null,
      mergedAt: '',
      createdAt: now,
      updatedAt: now
    }
    delete record.id
    const id = await db.postmarks.add(record)
    if (image && image.dataUrl) {
      await saveAsset({
        ownerType: 'postmark',
        ownerId: id,
        side: 'sample',
        dataUrl: image.dataUrl,
        fileName: image.fileName,
        updatedAt: now
      })
    }
    await load()
    return id
  }

  async function update(id: number, patch: Partial<Postmark>): Promise<void> {
    await db.postmarks.update(id, { ...patch, updatedAt: nowIso() })
    await load()
  }

  async function remove(id: number): Promise<void> {
    await db.postmarks.delete(id)
    await load()
  }

  function byId(id: number | null | undefined): Postmark | null {
    if (id == null) return null
    return list.value.find((p) => p.id === id) ?? null
  }

  function statusOf(id: number): PostmarkStatus {
    return byId(id)?.status ?? 'active'
  }

  /** 在用邮戳（登记新封等场景只能选在用戳） */
  const activeList = computed(() => list.value.filter((p) => p.status !== 'merged'))
  /** 已停用（并入他戳）邮戳，编号仍保留在目录中 */
  const mergedList = computed(() => list.value.filter((p) => p.status === 'merged'))

  /** 已并入某枚在用戳的停用戳列表（封详情据此标注「含已并入」的原编号） */
  function mergedSourcesOf(keepId: number | null | undefined): Postmark[] {
    if (keepId == null) return []
    return mergedList.value.filter((p) => p.mergedIntoId === keepId)
  }

  /** 停用戳的并入去向短标签，如「PM-0001 上海邮政总局」；在用戳返回空串 */
  function mergeTargetLabelOf(pm: Postmark | null | undefined): string {
    if (!pm || pm.status !== 'merged' || pm.mergedIntoId == null) return ''
    const target = byId(pm.mergedIntoId)
    return target ? `${target.pmNo} ${target.office}` : `未登记邮戳 #${pm.mergedIntoId}`
  }

  /**
   * 合并重复邮戳：
   * 1. 重复戳关联的实寄封全部改挂保留戳；同一封已挂保留戳时只去掉重复戳，不重复登记；
   * 2. 重复戳停用并记录并入去向；编号与记录保留，可在目录与封详情中追溯。
   * 所有写入处于同一个 Dexie 事务中，任一失败则邮戳与全部封回滚到合并前状态。
   */
  async function mergePostmarks(
    keepId: number,
    duplicateId: number
  ): Promise<MergePostmarkResult> {
    if (keepId === duplicateId) throw new Error('保留戳与重复戳不能是同一枚')
    const now = nowIso()
    let result: MergePostmarkResult = { moved: 0, skipped: 0 }
    await db.transaction('rw', db.postmarks, db.covers, async () => {
      const keep = await db.postmarks.get(keepId)
      const duplicate = await db.postmarks.get(duplicateId)
      if (!keep || !duplicate) throw new Error('选择的邮戳不存在')
      if (keep.status === 'merged') throw new Error('保留戳已停用，不能作为合并目标')
      if (duplicate.status === 'merged') throw new Error('重复戳已停用，不能再次合并')

      const affected = await db.covers
        .filter((cover) => cover.cancelPmIds.includes(duplicateId))
        .toArray()
      let moved = 0
      let skipped = 0
      for (const cover of affected) {
        if (typeof cover.id !== 'number') continue
        const nextIds = cover.cancelPmIds.filter((pmId) => pmId !== duplicateId)
        if (nextIds.includes(keepId)) {
          skipped += 1
        } else {
          nextIds.push(keepId)
          moved += 1
        }
        await db.covers.update(cover.id, { cancelPmIds: nextIds, updatedAt: now })
      }
      await db.postmarks.update(duplicateId, {
        status: 'merged',
        mergedIntoId: keepId,
        mergedAt: now,
        updatedAt: now
      })
      result = { moved, skipped }
    })
    await load()
    return result
  }

  /** 恢复停用戳为在用（不回改已改挂的封，原并入关系清空） */
  async function restore(id: number): Promise<void> {
    const pm = byId(id)
    if (!pm || pm.status !== 'merged') return
    await db.postmarks.update(id, {
      status: 'active',
      mergedIntoId: null,
      mergedAt: '',
      updatedAt: nowIso()
    })
    await load()
  }

  /** 「编目号 + 局所」短标签，供关联列表与详情页复用 */
  const labelOf = computed(() => {
    return (id: number): string => {
      const pm = byId(id)
      return pm ? `${pm.pmNo} ${pm.office}` : `未登记邮戳 #${id}`
    }
  })

  const total = computed(() => list.value.length)
  const scarceCount = computed(
    () => list.value.filter((p) => p.scarceLevel === '罕见' || p.scarceLevel === '孤品').length
  )

  return {
    list,
    activeList,
    mergedList,
    loading,
    loaded,
    total,
    scarceCount,
    load,
    nextPmNo,
    create,
    update,
    remove,
    byId,
    statusOf,
    mergedSourcesOf,
    mergeTargetLabelOf,
    mergePostmarks,
    restore,
    labelOf
  }
})
