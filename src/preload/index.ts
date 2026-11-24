import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo, LoginResult, StaffPublic } from '@shared/types'
import type { CloseDayResult, DayEndSummary } from '@shared/dayend'
import type { CelebrationDto, CustomerListRow, CustomerProfile, CustomerSaveInput } from '@shared/customers'
import type { AltConfig, AltContext, AltJobDto, AltList, DeliverInput, DeliverResult, GarmentChoice, NewAlterationInput, TailorDto, TailorInput } from '@shared/alterations'
import type { ReportDto, ReportPeriod, ReportTab } from '@shared/reports'
import type { AllSettings, BackupInfo, CoinSettings, PrinterSettings, ReceiptSettings, ShopSettings, StaffAdminRow, StaffSaveInput } from '@shared/settings'
import type { GstScheme } from '@shared/types'
import type { StickerContext, StickerItem, StickerPrintResult } from '@shared/stickers'
import type { PieceHistoryDto } from '@shared/serials'
import type { BillDetail, BillListRow, BillPeriod, CancelInput } from '@shared/bills'
import type { BillForReturn, CreditNoteDto, ReturnBillRow, ReturnInput, ReturnResult } from '@shared/returns'
import type { AdjustInput, ApprovalInput, ApproverDto, CountDto, MoveFullRow, StockOutInput } from '@shared/stockops'
import type {
  BillDto, BillingContext, BunchScan, CustomerDto, HeldBillDto, HeldPayload, NewBillInput, NewCustomerInput, ScannedPiece, SellableVariant
} from '@shared/billing'
import type {
  CategoryDto, ImportPreview, ImportResult, MoveRow, NewCategoryInput, NewProductInput, PieceScan, ProductPhotoDto, ProductDetail, ProductListRow, PurchaseRow,
  StockInInput, StockRow, SupplierDto, VariantSearchRow
} from '@shared/catalogue'

/** Unwraps the main process's {ok,data|error}; failures become thrown Errors with a readable message. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as { ok: true; data: T } | { ok: false; error: string }
  if (!r.ok) throw new Error(r.error)
  return r.data
}

const api = {
  app: { info: () => call<AppInfo>('app:info'), logo: () => call<string | null>('app:logo'), mySales: () => call<number>('app:mySales') },
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
    trackSerials: (id: string, on: boolean) => call<{ newSerials: number }>('cat:trackSerials', id, on),
    archive: (id: string) => call<void>('cat:archive', id),
    restore: (id: string) => call<void>('cat:restore', id)
  },
  billing: {
    context: () => call<BillingContext>('billing:context'),
    search: (q: string) => call<SellableVariant[]>('billing:search', q),
    archived: (q: string) => call<string[]>('billing:archived', q),
    scanPiece: (code: string, inBill: { variantId: string; serial: string }[]) => call<ScannedPiece | null>('billing:scanPiece', code, inBill),
    pickPiece: (variantId: string, inBill: { variantId: string; serial: string }[]) => call<ScannedPiece>('billing:pickPiece', variantId, inBill),
    scanBunch: (code: string, inBill: { variantId: string; serial: string }[]) => call<BunchScan | null>('billing:scanBunch', code, inBill),
    variants: (ids: string[]) => call<SellableVariant[]>('billing:variants', ids),
    photo: (variantId: string) => call<string | null>('billing:photo', variantId),
    openDay: (openingCash: number) => call<{ id: string }>('billing:openDay', openingCash),
    create: (input: NewBillInput) => call<BillDto>('billing:create', input),
    bill: (id: string) => call<BillDto>('billing:bill', id),
    hold: (payload: HeldPayload) => call<void>('billing:hold', payload),
    held: () => call<HeldBillDto[]>('billing:held'),
    resume: (id: string) => call<HeldPayload & { notes: string[] }>('billing:resume', id)
  },
  alterations: {
    list: (q = '') => call<AltList>('alt:list', q),
    byBill: (billId: string) => call<AltJobDto[]>('alt:byBill', billId),
    context: () => call<AltContext>('alt:context'),
    customer: (mobile: string) => call<{ id: string; name: string; mobile: string } | null>('alt:customer', mobile),
    customerSearch: (q: string) => call<{ id: string; name: string; mobile: string }[]>('alt:customerSearch', q),
    garments: (customerId: string) => call<GarmentChoice[]>('alt:garments', customerId),
    create: (input: NewAlterationInput) => call<AltJobDto>('alt:create', input),
    advance: (id: string) => call<AltJobDto>('alt:advance', id),
    deliver: (input: DeliverInput) => call<DeliverResult>('alt:deliver', input),
    saveTailor: (input: TailorInput) => call<TailorDto[]>('alt:saveTailor', input),
    saveConfig: (cfg: AltConfig) => call<AltConfig>('alt:saveConfig', cfg)
  },
  reports: {
    get: (tab: ReportTab, period: ReportPeriod, deadDays = 30) => call<ReportDto>('reports:get', tab, period, deadDays),
    exportExcel: (tab: ReportTab, period: ReportPeriod, deadDays = 30) => call<string | null>('reports:exportExcel', tab, period, deadDays),
    exportPdf: (tab: ReportTab, period: ReportPeriod, deadDays = 30) => call<string | null>('reports:exportPdf', tab, period, deadDays)
  },
  settings: {
    get: () => call<AllSettings>('settings:get'),
    saveShop: (v: ShopSettings) => call<ShopSettings>('settings:saveShop', v),
    saveGst: (v: GstScheme) => call<GstScheme>('settings:saveGst', v),
    saveReceipt: (v: ReceiptSettings) => call<ReceiptSettings>('settings:saveReceipt', v),
    savePrinters: (v: PrinterSettings) => call<PrinterSettings>('settings:savePrinters', v),
    saveCoins: (v: CoinSettings) => call<CoinSettings>('settings:saveCoins', v),
    staff: () => call<StaffAdminRow[]>('settings:staff'),
    saveStaff: (v: StaffSaveInput) => call<StaffAdminRow[]>('settings:saveStaff', v),
    setPin: (id: string, pin: string) => call<void>('settings:setPin', id, pin),
    backups: () => call<BackupInfo>('settings:backups'),
    saveBackupFolder: (f: string) => call<BackupInfo>('settings:saveBackupFolder', f),
    finishSetup: () => call<true>('settings:finishSetup'),
    backupNow: () => call<BackupInfo>('settings:backupNow'),
    restore: (file: string) => call<{ restarting: true }>('settings:restore', file),
    restoreFromFile: () => call<{ restarting: true } | null>('settings:restoreFromFile')
  },
  print: {
    receipt: (billId: string, copy = false) => call<void>('print:receipt', billId, copy),
    alteration: (jobId: string, which: 'tag' | 'slip') => call<void>('print:alteration', jobId, which),
    testReceipt: () => call<void>('print:testReceipt'),
    testSticker: () => call<void>('print:testSticker'),
    openDrawer: () => call<void>('print:openDrawer'),
    dayEnd: (sessionId: string) => call<void>('print:dayEnd', sessionId)
  },
  stickers: {
    context: () => call<StickerContext>('stickers:context'),
    items: (ids: string[]) => call<StickerItem[]>('stickers:items', ids),
    lastPurchase: (purchaseId?: string) => call<StickerItem[]>('stickers:lastPurchase', purchaseId),
    stock: (ids: string[]) => call<StickerItem[]>('stickers:stock', ids),
    piece: (code: string) => call<StickerItem>('stickers:piece', code),
    printers: () => call<string[]>('stickers:printers'),
    savePrefs: (p: { size: string; printer: string }) => call<StickerContext>('stickers:savePrefs', p),
    print: (lines: { variantId: string; qty: number; serials?: string[]; bunch?: string }[]) => call<StickerPrintResult>('stickers:print', lines)
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
    scanPiece: (code: string, inList: { variantId: string; serial: string }[], want: 'free' | 'gone' = 'free') => call<PieceScan | null>('stock:scanPiece', code, inList, want),
    levels: (q = '', lowOnly = false) => call<StockRow[]>('stock:levels', q, lowOnly),
    history: (variantId: string) => call<MoveRow[]>('stock:history', variantId),
    suppliers: () => call<SupplierDto[]>('stock:suppliers'),
    addSupplier: (s: { name: string; mobile?: string; gstin?: string }) => call<SupplierDto>('stock:addSupplier', s),
    in: (input: StockInInput) => call<{ purchaseId: string; qty: number }>('stock:in', input),
    recent: () => call<PurchaseRow[]>('stock:recent'),
    out: (input: StockOutInput) => call<{ id: string; qty: number }>('stock:out', input),
    adjust: (input: AdjustInput) => call<{ stock: number; newSerials?: string[] }>('stock:adjust', input),
    pieceHistory: (code: string) => call<PieceHistoryDto>('serials:history', code),
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
