import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo, LoginResult, StaffPublic } from '@shared/types'
import type { CloseDayResult, DayEndSummary } from '@shared/dayend'
import type { CelebrationDto, CustomerListRow, CustomerProfile, CustomerSaveInput } from '@shared/customers'
import type { AltConfig, AltContext, AltJobDto, AltList, DeliverInput, DeliverResult, GarmentChoice, NewAlterationInput, TailorDto, TailorInput } from '@shared/alterations'
import type { StickerContext, StickerItem, StickerPrintResult } from '@shared/stickers'
import type { BillDetail, BillListRow, BillPeriod, CancelInput } from '@shared/bills'
import type { BillForReturn, CreditNoteDto, ReturnBillRow, ReturnInput, ReturnResult } from '@shared/returns'
import type { AdjustInput, ApprovalInput, ApproverDto, CountDto, MoveFullRow, StockOutInput } from '@shared/stockops'
import type {
  BillDto, BillingContext, CustomerDto, HeldBillDto, HeldPayload, NewBillInput, NewCustomerInput, SellableVariant
} from '@shared/billing'
import type {
  CategoryDto, ImportPreview, ImportResult, MoveRow, NewCategoryInput, NewProductInput, ProductPhotoDto, ProductDetail, ProductListRow, PurchaseRow,
  StockInInput, StockRow, SupplierDto, VariantSearchRow
} from '@shared/catalogue'

/** Unwraps the main process's {ok,data|error}; failures become thrown Errors with a readable message. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as { ok: true; data: T } | { ok: false; error: string }
  if (!r.ok) throw new Error(r.error)
  return r.data
}

const api = {
  app: { info: () => call<AppInfo>('app:info'), mySales: () => call<number>('app:mySales') },
  auth: {
    staff: () => call<StaffPublic[]>('auth:staff'),
    login: (id: string, pin: string) => call<LoginResult>('auth:login', id, pin),
    changePin: (pin: string) => call<{ ok: boolean; error?: string; staff?: StaffPublic }>('auth:changePin', pin),
    logout: () => call<void>('auth:logout')
  },
  catalogue: {
    categories: () => call<CategoryDto[]>('cat:categories'),
    products: (q = '', categoryId = '', archived = false) => call<ProductListRow[]>('cat:products', q, categoryId, archived),
    product: (id: string) => call<ProductDetail>('cat:product', id),
    photos: (productId: string) => call<ProductPhotoDto[]>('cat:photos', productId),
    setColourPhoto: (productId: string, colour: string, file: string) => call<void>('cat:setColourPhoto', productId, colour, file),
    removePhoto: (productId: string, colour: string) => call<void>('cat:removePhoto', productId, colour),
    savePhoto: (jpeg: Uint8Array) => call<{ file: string; dataUrl: string }>('photo:save', jpeg),
    addCategory: (input: NewCategoryInput) => call<CategoryDto>('cat:addCategory', input),
    create: (input: NewProductInput) => call<{ id: string; variantIds: string[] }>('cat:create', input),
    update: (id: string, patch: { name: string; brand: string; categoryId: string }) => call<void>('cat:update', id, patch),
    prices: (variantId: string, mrp: number, salePrice: number) => call<void>('cat:prices', variantId, mrp, salePrice),
    brandBarcode: (variantId: string, code: string) => call<void>('cat:brandBarcode', variantId, code),
    archive: (id: string) => call<void>('cat:archive', id),
    restore: (id: string) => call<void>('cat:restore', id)
  },
  billing: {
    context: () => call<BillingContext>('billing:context'),
    search: (q: string) => call<SellableVariant[]>('billing:search', q),
    archived: (q: string) => call<string[]>('billing:archived', q),
    variants: (ids: string[]) => call<SellableVariant[]>('billing:variants', ids),
    photo: (variantId: string) => call<string | null>('billing:photo', variantId),
    openDay: (openingCash: number) => call<{ id: string }>('billing:openDay', openingCash),
    create: (input: NewBillInput) => call<BillDto>('billing:create', input),
    bill: (id: string) => call<BillDto>('billing:bill', id),
    hold: (payload: HeldPayload) => call<void>('billing:hold', payload),
    held: () => call<HeldBillDto[]>('billing:held'),
    resume: (id: string) => call<HeldPayload>('billing:resume', id)
  },
  alterations: {
    list: (q = '') => call<AltList>('alt:list', q),
    byBill: (billId: string) => call<AltJobDto[]>('alt:byBill', billId),
    context: () => call<AltContext>('alt:context'),
    customer: (mobile: string) => call<{ id: string; name: string; mobile: string } | null>('alt:customer', mobile),
    garments: (customerId: string) => call<GarmentChoice[]>('alt:garments', customerId),
    create: (input: NewAlterationInput) => call<AltJobDto>('alt:create', input),
    advance: (id: string) => call<AltJobDto>('alt:advance', id),
    deliver: (input: DeliverInput) => call<DeliverResult>('alt:deliver', input),
    saveTailor: (input: TailorInput) => call<TailorDto[]>('alt:saveTailor', input),
    saveConfig: (cfg: AltConfig) => call<AltConfig>('alt:saveConfig', cfg)
  },
  stickers: {
    context: () => call<StickerContext>('stickers:context'),
    items: (ids: string[]) => call<StickerItem[]>('stickers:items', ids),
    lastPurchase: (purchaseId?: string) => call<StickerItem[]>('stickers:lastPurchase', purchaseId),
    printers: () => call<string[]>('stickers:printers'),
    savePrefs: (p: { size: string; printer: string }) => call<StickerContext>('stickers:savePrefs', p),
    print: (lines: { variantId: string; qty: number }[]) => call<StickerPrintResult>('stickers:print', lines)
  },
  bills: {
    list: (period: BillPeriod, q = '') => call<BillListRow[]>('bills:list', period, q),
    detail: (id: string) => call<BillDetail>('bills:detail', id),
    cancel: (input: CancelInput) => call<BillDetail>('bills:cancel', input)
  },
  returns: {
    find: (q: string) => call<ReturnBillRow[]>('returns:find', q),
    bill: (id: string) => call<BillForReturn>('returns:bill', id),
    do: (input: ReturnInput) => call<ReturnResult>('returns:do', input),
    creditNotes: (customerId: string) => call<CreditNoteDto[]>('returns:creditNotes', customerId)
  },
  day: {
    summary: () => call<DayEndSummary>('day:summary'),
    addExpense: (amount: number, note: string) => call<void>('day:addExpense', amount, note),
    close: (countedCash: number) => call<CloseDayResult>('day:close', countedCash)
  },
  customers: {
    list: (q = '') => call<CustomerListRow[]>('customers:list', q),
    get: (id: string) => call<CustomerProfile>('customers:get', id),
    save: (input: CustomerSaveInput) => call<CustomerProfile>('customers:save', input),
    remove: (id: string) => call<void>('customers:delete', id),
    today: () => call<CelebrationDto[]>('customers:today'),
    find: (mobile: string) => call<CustomerDto | null>('customer:find', mobile),
    create: (input: NewCustomerInput) => call<CustomerDto>('customer:create', input)
  },
  import: {
    template: () => call<string | null>('import:template'),
    choose: () => call<ImportPreview | null>('import:choose'),
    commit: (token: string) => call<ImportResult>('import:commit', token)
  },
  stock: {
    search: (q: string) => call<VariantSearchRow[]>('stock:search', q),
    levels: (q = '', lowOnly = false) => call<StockRow[]>('stock:levels', q, lowOnly),
    history: (variantId: string) => call<MoveRow[]>('stock:history', variantId),
    suppliers: () => call<SupplierDto[]>('stock:suppliers'),
    addSupplier: (s: { name: string; mobile?: string; gstin?: string }) => call<SupplierDto>('stock:addSupplier', s),
    in: (input: StockInInput) => call<{ purchaseId: string; qty: number }>('stock:in', input),
    recent: () => call<PurchaseRow[]>('stock:recent'),
    out: (input: StockOutInput) => call<{ id: string; qty: number }>('stock:out', input),
    adjust: (input: AdjustInput) => call<{ stock: number }>('stock:adjust', input),
    moves: () => call<MoveFullRow[]>('stock:moves'),
    approvers: () => call<ApproverDto[]>('app:approvers')
  },
  count: {
    get: () => call<CountDto | null>('count:get'),
    start: () => call<CountDto>('count:start'),
    scan: (code: string) => call<{ variantId: string; label: string; counted: number }>('count:scan', code),
    set: (variantId: string, counted: number) => call<void>('count:set', variantId, counted),
    discard: () => call<void>('count:discard'),
    approve: (approval?: ApprovalInput) => call<{ adjusted: number }>('count:approve', approval)
  }
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
