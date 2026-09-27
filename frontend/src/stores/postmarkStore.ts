import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, saveAsset } from '@/utils/db'
import type { Postmark } from '@/types/postmark'
import { mergePostmarks, reactivatePostmark, type MergeResult } from '@/utils/postmarkMerge'
import { nextSerialNo, nowIso } from '@/utils/id'

export interface ImagePayload {
  dataUrl: string
  fileName: string
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

  /** 在用邮戳：登记新封时只能选到这些 */
  const activeList = computed(() => list.value.filter((p) => p.status !== 'inactive'))
  const inactiveCount = computed(() => list.value.filter((p) => p.status === 'inactive').length)

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

  /**
   * 合并两枚常被认成同一戳的邮戳：
   * 重复戳关联的实寄封全部改挂保留戳（已挂的不重复登记），
   * 完成后重复戳停用并标出并入去向；事务保证任一写入失败全部回滚。
   */
  async function merge(keepId: number, duplicateId: number): Promise<MergeResult> {
    const result = await mergePostmarks(keepId, duplicateId)
    await load()
    return result
  }

  /** 恢复停用记录，并按封上痕迹还原合并前的销票关系。 */
  async function reactivate(id: number): Promise<number> {
    const affected = await reactivatePostmark(id)
    await load()
    return affected
  }

  function byId(id: number | null | undefined): Postmark | null {
    if (id == null) return null
    return list.value.find((p) => p.id === id) ?? null
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
    loading,
    loaded,
    total,
    scarceCount,
    activeList,
    inactiveCount,
    load,
    nextPmNo,
    create,
    update,
    remove,
    merge,
    reactivate,
    byId,
    labelOf
  }
})
