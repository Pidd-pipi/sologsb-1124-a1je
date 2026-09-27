<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile } from 'element-plus'
import StampCard from '@/components/common/StampCard.vue'
import ScarceTag from '@/components/common/ScarceTag.vue'
import { useCatalogFilter } from '@/hooks/useCatalogFilter'
import { useCoverStore } from '@/stores/coverStore'
import { usePostmarkStore, type ImagePayload } from '@/stores/postmarkStore'
import type { Postmark } from '@/types/postmark'
import {
  INK_COLORS,
  POSTMARK_TYPES,
  PROVINCES,
  SCARCE_LEVELS,
  createEmptyPostmark
} from '@/types/postmark'
import { clearDraft, draftSavedAt, loadDraft, saveDraft } from '@/utils/draft'
import { nowIso, toNumber } from '@/utils/id'

const store = usePostmarkStore()
const coverStore = useCoverStore()
const source = computed(() => store.list)
const { filters, filtered, activeCount, reset } = useCatalogFilter<Postmark>('postmark', source)

const viewMode = ref<'wall' | 'list'>('wall')
const dialogVisible = ref(false)
const detailVisible = ref(false)
const sampleVisible = ref(false)
const mergeVisible = ref(false)
const merging = ref(false)
const current = ref<Postmark | null>(null)
const sampleText = ref('')
const imagePayload = ref<ImagePayload | null>(null)
const draftHint = ref('')
const form = reactive<Postmark>(createEmptyPostmark())

/** 合并表单：重复戳（停用）→ 保留戳 */
const mergeForm = reactive<{ duplicateId: number | null; keepId: number | null }>({
  duplicateId: null,
  keepId: null
})

onMounted(async () => {
  if (!store.loaded) await store.load()
  if (!coverStore.loaded) await coverStore.load()
  draftHint.value = draftSavedAt('postmark')
})

watch(
  form,
  () => {
    if (!dialogVisible.value) return
    saveDraft('postmark', { ...form, lettering: { ...form.lettering } })
    draftHint.value = nowIso()
  },
  { deep: true }
)

function openCreate(): void {
  Object.assign(form, createEmptyPostmark())
  form.pmNo = store.nextPmNo()
  form.lettering = { top: '', middle: '', bottom: '' }
  imagePayload.value = null
  const draft = loadDraft<Postmark>('postmark')
  if (draft) {
    Object.assign(form, draft)
    form.lettering = draft.lettering ?? { top: '', middle: '', bottom: '' }
    if (form.imageDataUrl) imagePayload.value = { dataUrl: form.imageDataUrl, fileName: '草稿戳样' }
  }
  dialogVisible.value = true
}

function discardDraft(): void {
  clearDraft('postmark')
  draftHint.value = ''
  Object.assign(form, createEmptyPostmark())
  form.pmNo = store.nextPmNo()
  form.lettering = { top: '', middle: '', bottom: '' }
  imagePayload.value = null
  ElMessage.info('已清除本地草稿')
}

function onFileChange(file: UploadFile): void {
  const raw = file.raw
  if (!raw) return
  if (raw.size > 2 * 1024 * 1024) {
    ElMessage.warning('戳样图请控制在 2MB 以内')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = String(reader.result ?? '')
    form.imageDataUrl = dataUrl
    imagePayload.value = { dataUrl, fileName: raw.name }
  }
  reader.readAsDataURL(raw)
}

async function submit(): Promise<void> {
  if (!form.office.trim()) {
    ElMessage.warning('请填写使用局所')
    return
  }
  if (toNumber(form.yearFrom) > toNumber(form.yearTo)) {
    ElMessage.warning('使用年代的起始年不能晚于结束年')
    return
  }
  const pmNo = form.pmNo || store.nextPmNo()
  await store.create({ ...form, pmNo, lettering: { ...form.lettering } }, imagePayload.value)
  clearDraft('postmark')
  draftHint.value = ''
  dialogVisible.value = false
  ElMessage.success(`已编目邮戳 ${pmNo}`)
}

function showDetail(pm: Postmark): void {
  current.value = pm
  detailVisible.value = true
}

function buildSampleText(pm: Postmark): string {
  return [
    `戳样条目 ${pm.pmNo}`,
    `戳型：${pm.type}`,
    `局所：${pm.office}（${pm.province || '省份待考'}）`,
    `使用年代：${pm.yearFrom}-${pm.yearTo}`,
    `戳面日期：${pm.dateOnStamp || '未注'}`,
    `戳径/墨色：${pm.diameter}mm / ${pm.inkColor}`,
    `戳面文字：上格「${pm.lettering.top}」 中格「${pm.lettering.middle}」 下格「${pm.lettering.bottom}」`,
    `文字：${pm.bilingual ? '中英双文字' : '单文字'}`,
    `稀见度：${pm.scarceLevel}`,
    `备注：${pm.note || '无'}`
  ].join('\n')
}

function generateSample(pm: Postmark): void {
  sampleText.value = buildSampleText(pm)
  sampleVisible.value = true
}

async function copySample(): Promise<void> {
  try {
    await navigator.clipboard.writeText(sampleText.value)
    ElMessage.success('戳样条目已复制')
  } catch {
    ElMessage.info('浏览器未授权剪贴板，请手动选择文本')
  }
}

/* ------------------------------ 邮戳合并 ------------------------------ */

function pmOption(pm: Postmark): { label: string; value: number } | null {
  return typeof pm.id === 'number'
    ? { label: `${pm.pmNo} ${pm.office}（${pm.type}）`, value: pm.id }
    : null
}

/** 重复戳候选：默认列出全部，已停用的标注并入去向 */
const duplicateOptions = computed(() =>
  store.list.flatMap((pm) => {
    const opt = pmOption(pm)
    return opt ? [{ ...opt, status: pm.status, mergedIntoPmId: pm.mergedIntoPmId }] : []
  })
)

/** 保留戳候选：只可选择在用戳，且不能与重复戳相同 */
const keepOptions = computed(() =>
  store.activeList
    .filter((pm) => pm.id !== mergeForm.duplicateId)
    .map(pmOption)
    .filter((o): o is { label: string; value: number } => o != null)
)

const duplicatePm = computed(() =>
  mergeForm.duplicateId == null ? null : store.byId(mergeForm.duplicateId)
)
const keepPm = computed(() => (mergeForm.keepId == null ? null : store.byId(mergeForm.keepId)))

/** 受影响封预览：挂着重复戳的封；区分「将改挂」与「已挂保留戳，只去重」 */
const affectedCovers = computed(() => {
  const dupId = mergeForm.duplicateId
  const keepId = mergeForm.keepId
  if (dupId == null || keepId == null) return []
  return coverStore.list
    .filter((c) => c.cancelPmIds.includes(dupId))
    .map((c) => ({
      id: c.id as number,
      coverNo: c.coverNo,
      hadKeep: c.cancelPmIds.includes(keepId)
    }))
})

const willRehookCount = computed(() => affectedCovers.value.filter((c) => !c.hadKeep).length)
const willDedupCount = computed(() => affectedCovers.value.filter((c) => c.hadKeep).length)

function openMerge(pm?: Postmark): void {
  mergeForm.duplicateId = pm && typeof pm.id === 'number' ? pm.id : null
  mergeForm.keepId = null
  mergeVisible.value = true
}

async function submitMerge(): Promise<void> {
  if (mergeForm.duplicateId == null || mergeForm.keepId == null) {
    ElMessage.warning('请先选定重复戳与保留戳')
    return
  }
  if (mergeForm.duplicateId === mergeForm.keepId) {
    ElMessage.warning('保留戳与重复戳不能是同一枚邮戳')
    return
  }
  merging.value = true
  try {
    const result = await store.merge(mergeForm.keepId, mergeForm.duplicateId)
    mergeVisible.value = false
    ElMessage.success(
      `已并入 ${result.keep.pmNo}：${result.rehookedCoverCount} 封改挂，` +
        `${result.dedupCoverCount} 封已有该戳仅去重，${result.duplicate.pmNo} 已停用`
    )
    // 详情抽屉若正展示被停用的重复戳，刷新为最新记录
    if (current.value?.id === result.duplicate.id) {
      current.value = store.byId(result.duplicate.id)
    }
  } catch (err) {
    // 事务已整体回滚，邮戳与所有封均保持合并前状态
    ElMessage.error(`合并失败，数据已全部还原：${err instanceof Error ? err.message : '未知错误'}`)
  } finally {
    merging.value = false
  }
}

function mergedIntoLabel(pm: Postmark): string {
  if (pm.mergedIntoPmId == null) return ''
  const target = store.byId(pm.mergedIntoPmId)
  return target ? `${target.pmNo} ${target.office}` : `邮戳 #${pm.mergedIntoPmId}`
}

async function reactivate(pm: Postmark): Promise<void> {
  if (typeof pm.id !== 'number') return
  try {
    await ElMessageBox.confirm(
      `确定恢复 ${pm.pmNo} 吗？该戳关联的实寄封将按合并痕迹还原销票关系，并入去向标记会被清除。`,
      '恢复停用邮戳',
      { type: 'warning', confirmButtonText: '恢复使用', cancelButtonText: '再想想' }
    )
  } catch {
    return
  }
  try {
    const affected = await store.reactivate(pm.id)
    ElMessage.success(`已恢复 ${pm.pmNo}，并还原 ${affected} 封的销票关系`)
    current.value = store.byId(pm.id)
  } catch (err) {
    ElMessage.error(`恢复失败，数据已全部还原：${err instanceof Error ? err.message : '未知错误'}`)
  }
}
</script>

<template>
  <div class="gb-page postmark-page">
    <header class="gb-page__head">
      <div>
        <h1 class="gb-page__title">邮戳目录</h1>
        <p class="gb-page__subtitle">
          共 {{ store.total }} 枚邮戳，其中罕见以上 {{ store.scarceCount }} 枚；按戳型、局所、年代区间检索。
        </p>
      </div>
      <div class="postmark-page__actions">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="wall">图片墙</el-radio-button>
          <el-radio-button value="list">列表</el-radio-button>
        </el-radio-group>
        <el-button type="warning" plain @click="openMerge()">合并邮戳</el-button>
        <el-button type="primary" @click="openCreate">新增邮戳</el-button>
      </div>
    </header>

    <section class="gb-panel">
      <h2 class="gb-panel__title">筛选（{{ activeCount }} 项生效）</h2>
      <el-form :inline="true" label-width="72px" @submit.prevent>
        <el-form-item label="关键词">
          <el-input v-model="filters.keyword" placeholder="编目号 / 戳面文字 / 备注" clearable />
        </el-form-item>
        <el-form-item label="戳型">
          <el-select v-model="filters.type" placeholder="全部戳型" clearable style="width: 150px">
            <el-option v-for="t in POSTMARK_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="局所">
          <el-input v-model="filters.office" placeholder="如 上海" clearable />
        </el-form-item>
        <el-form-item label="省份">
          <el-select v-model="filters.province" placeholder="全部省份" clearable style="width: 130px">
            <el-option v-for="p in PROVINCES" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="年代区间">
          <el-input v-model="filters.era" placeholder="如 1900-1949" clearable style="width: 150px" />
        </el-form-item>
        <el-form-item label="稀见度">
          <el-select v-model="filters.scarceLevel" placeholder="全部" clearable style="width: 120px">
            <el-option v-for="s in SCARCE_LEVELS" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width: 120px">
            <el-option label="在用" value="active" />
            <el-option label="已停用" value="inactive" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序">
          <el-select v-model="filters.sortKey" style="width: 150px">
            <el-option label="最近更新" value="recent" />
            <el-option label="编号升序" value="noAsc" />
            <el-option label="年代升序" value="yearAsc" />
            <el-option label="年代降序" value="yearDesc" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button @click="reset">重置筛选</el-button>
        </el-form-item>
      </el-form>
    </section>

    <p v-if="!filtered.length" class="gb-empty">没有符合当前条件的邮戳，试试放宽年代区间或清空戳型。</p>

    <div v-else-if="viewMode === 'wall'" class="gb-grid">
      <StampCard
        v-for="pm in filtered"
        :key="pm.id"
        :postmark="pm"
        :active="current?.id === pm.id"
        @select="showDetail"
      />
    </div>

    <el-table v-else :data="filtered" border stripe @row-click="showDetail">
      <el-table-column prop="pmNo" label="编目号" width="120" />
      <el-table-column prop="type" label="戳型" width="130" />
      <el-table-column prop="office" label="使用局所" min-width="160" />
      <el-table-column prop="province" label="省份" width="90" />
      <el-table-column label="使用年代" width="120">
        <template #default="{ row }">{{ row.yearFrom }}-{{ row.yearTo }}</template>
      </el-table-column>
      <el-table-column prop="dateOnStamp" label="戳面日期" width="120" />
      <el-table-column label="戳径" width="90">
        <template #default="{ row }">{{ row.diameter }}mm</template>
      </el-table-column>
      <el-table-column prop="inkColor" label="墨色" width="80" />
      <el-table-column label="稀见度" width="100">
        <template #default="{ row }">
          <ScarceTag :level="row.scarceLevel" />
        </template>
      </el-table-column>
      <el-table-column label="状态" width="170">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'inactive'" size="small" type="info" effect="dark">
            已停用 → {{ mergedIntoLabel(row) }}
          </el-tag>
          <el-tag v-else size="small" type="success" effect="plain">在用</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="250">
        <template #default="{ row }">
          <el-button size="small" link type="primary" @click.stop="showDetail(row)">查看</el-button>
          <el-button size="small" link type="primary" @click.stop="generateSample(row)">
            生成戳样条目
          </el-button>
          <el-button
            v-if="row.status !== 'inactive'"
            size="small"
            link
            type="warning"
            @click.stop="openMerge(row)"
          >
            并入…
          </el-button>
          <el-button v-else size="small" link type="success" @click.stop="reactivate(row)">
            恢复
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="新增邮戳" width="720px">
      <el-form label-width="104px" label-position="right">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="编目号">
              <el-input v-model="form.pmNo" placeholder="留空自动生成" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="戳型">
              <el-select v-model="form.type" style="width: 100%">
                <el-option v-for="t in POSTMARK_TYPES" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="使用局所">
              <el-input v-model="form.office" placeholder="如 上海邮政总局" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="省份">
              <el-select v-model="form.province" placeholder="选择省份" clearable style="width: 100%">
                <el-option v-for="p in PROVINCES" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="年代起">
              <el-input-number v-model="form.yearFrom" :min="1800" :max="2100" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="年代止">
              <el-input-number v-model="form.yearTo" :min="1800" :max="2100" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="戳面日期">
              <el-date-picker
                v-model="form.dateOnStamp"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="戳面所注日期"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="墨色">
              <el-select v-model="form.inkColor" style="width: 100%">
                <el-option v-for="c in INK_COLORS" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="戳径(mm)">
              <el-input-number v-model="form.diameter" :min="10" :max="90" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="稀见度">
              <el-select v-model="form.scarceLevel" style="width: 100%">
                <el-option v-for="s in SCARCE_LEVELS" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="上格">
              <el-input v-model="form.lettering.top" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="中格">
              <el-input v-model="form.lettering.middle" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="下格">
              <el-input v-model="form.lettering.bottom" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="中英双文字">
              <el-switch v-model="form.bilingual" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="戳样图">
              <el-upload
                :auto-upload="false"
                :show-file-list="false"
                accept="image/*"
                :on-change="onFileChange"
              >
                <el-button>选择戳样图</el-button>
              </el-upload>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.note" type="textarea" :rows="2" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <div class="postmark-page__footer">
          <span class="postmark-page__draft">
            {{ draftHint ? '表单草稿已存入浏览器 localStorage' : '未保存草稿' }}
          </span>
          <span>
            <el-button link type="info" @click="discardDraft">清除草稿</el-button>
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" @click="submit">保存邮戳</el-button>
          </span>
        </div>
      </template>
    </el-dialog>

    <el-drawer v-model="detailVisible" title="邮戳档案" size="460px">
      <div v-if="current" class="postmark-page__detail">
        <el-alert
          v-if="current.status === 'inactive'"
          type="info"
          :closable="false"
          show-icon
          class="postmark-page__merged-alert"
        >
          <template #title>
            该戳已停用（{{ current.mergedAt ? current.mergedAt.slice(0, 10) : '日期未记' }}）
          </template>
          <div class="postmark-page__merged-body">
            原编号保留在册，已并入
            <strong>{{ mergedIntoLabel(current) }}</strong>
            ；关联实寄封均已改挂保留戳。
          </div>
        </el-alert>
        <div class="gb-figure">
          <img v-if="current.imageDataUrl" :src="current.imageDataUrl" :alt="`${current.pmNo} 戳样`" />
          <span v-else class="postmark-page__no-image">暂无戳样图</span>
        </div>
        <h3 class="gb-panel__title">{{ current.pmNo }} · {{ current.type }}</h3>
        <div class="postmark-page__detail-tags">
          <ScarceTag :level="current.scarceLevel" />
          <el-tag v-if="current.status === 'inactive'" size="small" type="info" effect="dark">已停用</el-tag>
          <el-tag v-else size="small" type="success" effect="plain">在用</el-tag>
        </div>
        <dl class="gb-facts">
          <div v-if="current.status === 'inactive'">
            <dt>并入去向</dt>
            <dd>{{ mergedIntoLabel(current) }}</dd>
          </div>
          <div><dt>使用局所</dt><dd>{{ current.office }}</dd></div>
          <div><dt>省份</dt><dd>{{ current.province || '待考' }}</dd></div>
          <div><dt>使用年代</dt><dd>{{ current.yearFrom }}-{{ current.yearTo }}</dd></div>
          <div><dt>戳面日期</dt><dd>{{ current.dateOnStamp || '未注' }}</dd></div>
          <div><dt>戳径</dt><dd>{{ current.diameter }} mm</dd></div>
          <div><dt>墨色</dt><dd>{{ current.inkColor }}</dd></div>
          <div><dt>戳面文字</dt><dd>{{ current.lettering.top }} / {{ current.lettering.middle }} / {{ current.lettering.bottom }}</dd></div>
          <div><dt>文字</dt><dd>{{ current.bilingual ? '中英双文字' : '单文字' }}</dd></div>
        </dl>
        <p class="postmark-page__note">{{ current.note || '暂无备注' }}</p>
        <div class="postmark-page__detail-actions">
          <el-button type="primary" plain @click="generateSample(current)">生成戳样条目</el-button>
          <el-button
            v-if="current.status !== 'inactive'"
            type="warning"
            plain
            @click="openMerge(current)"
          >
            作为重复戳并入…
          </el-button>
          <el-button v-else type="success" plain @click="reactivate(current)">恢复使用</el-button>
        </div>
      </div>
    </el-drawer>

    <el-dialog v-model="sampleVisible" title="戳样条目" width="560px">
      <el-input v-model="sampleText" type="textarea" :rows="10" readonly />
      <template #footer>
        <el-button @click="sampleVisible = false">关闭</el-button>
        <el-button type="primary" @click="copySample">复制条目</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="mergeVisible" title="合并重复邮戳" width="600px">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="合并后重复戳停用，原编号仍保留在目录与封详情；操作可在停用记录上恢复。"
        class="postmark-page__merge-alert"
      />
      <el-form label-width="104px" label-position="right">
        <el-form-item label="重复戳（停用）">
          <el-select
            v-model="mergeForm.duplicateId"
            placeholder="选择常被认错的重复戳"
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="opt in duplicateOptions"
              :key="opt.value"
              :label="opt.status === 'inactive' ? `${opt.label}（已停用）` : opt.label"
              :value="opt.value"
              :disabled="opt.status === 'inactive'"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="保留戳（在用）">
          <el-select
            v-model="mergeForm.keepId"
            placeholder="选择并入的保留戳"
            filterable
            style="width: 100%"
          >
            <el-option v-for="opt in keepOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
      </el-form>

      <div v-if="duplicatePm && keepPm" class="postmark-page__merge-preview">
        <p class="postmark-page__merge-line">
          <el-tag size="small" type="info" effect="dark">{{ duplicatePm.pmNo }}</el-tag>
          <span class="postmark-page__merge-arrow">并入</span>
          <el-tag size="small" type="success" effect="dark">{{ keepPm.pmNo }}</el-tag>
        </p>
        <p v-if="affectedCovers.length" class="postmark-page__merge-cover">
          将处理 {{ affectedCovers.length }} 封：{{ willRehookCount }} 封改挂保留戳；
          {{ willDedupCount }} 封已关联保留戳，只摘除重复登记，不重复登记。
        </p>
        <p v-else class="postmark-page__merge-cover">没有实寄封关联该重复戳，仅停用并标注去向。</p>
        <ul v-if="affectedCovers.length" class="postmark-page__merge-covers">
          <li v-for="c in affectedCovers" :key="c.id">
            <strong>{{ c.coverNo }}</strong>
            <el-tag v-if="c.hadKeep" size="small" type="warning" effect="plain">已有保留戳 · 去重</el-tag>
            <el-tag v-else size="small" type="primary" effect="plain">将改挂 {{ keepPm.pmNo }}</el-tag>
          </li>
        </ul>
        <p class="postmark-page__merge-atomic">
          合并在单个数据库事务内完成，任一写入失败，邮戳与全部实寄封都会回到合并前状态。
        </p>
      </div>

      <template #footer>
        <el-button @click="mergeVisible = false">取消</el-button>
        <el-button
          type="warning"
          :loading="merging"
          :disabled="mergeForm.duplicateId == null || mergeForm.keepId == null"
          @click="submitMerge"
        >
          确认合并并停用重复戳
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.postmark-page__actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.postmark-page__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.postmark-page__draft {
  font-size: 12px;
  color: var(--gb-muted);
}
.postmark-page__detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}
.postmark-page__no-image {
  font-size: 12px;
  color: var(--gb-muted);
}
.postmark-page__note {
  font-size: 13px;
  color: var(--gb-muted);
  line-height: 1.6;
}
.postmark-page__detail-tags {
  display: flex;
  gap: 8px;
  align-items: center;
}
.postmark-page__detail-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.postmark-page__merged-alert {
  align-self: stretch;
}
.postmark-page__merged-body {
  font-size: 12px;
  line-height: 1.6;
}
.postmark-page__merge-alert {
  margin-bottom: 14px;
}
.postmark-page__merge-preview {
  border: 1px dashed var(--gb-line);
  border-radius: 10px;
  padding: 12px 14px;
  background: #fffdf8;
}
.postmark-page__merge-line {
  margin: 0 0 8px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.postmark-page__merge-arrow {
  font-size: 13px;
  color: #8c3b2e;
}
.postmark-page__merge-cover {
  margin: 4px 0;
  font-size: 13px;
  color: #5a4a37;
}
.postmark-page__merge-covers {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: grid;
  gap: 6px;
  max-height: 168px;
  overflow: auto;
}
.postmark-page__merge-covers li {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
}
.postmark-page__merge-covers strong {
  color: #5d3325;
  min-width: 80px;
}
.postmark-page__merge-atomic {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--gb-muted);
}
</style>
