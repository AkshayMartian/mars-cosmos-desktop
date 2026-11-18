import { ipcMain } from 'electron'
import { chooseImportFile, saveImportTemplate } from './dialogs'
import { changePin, listActiveStaff, login, logout } from './services/auth'
import { listApprovers } from './services/approval'
import { addExpense, closeDay, daySummary } from './services/dayend'
import * as billing from './services/billing'
import * as bills from './services/bills'
import * as cat from './services/catalogue'
import { celebrationsToday, createCustomer, deleteCustomer, findCustomerByMobile, getCustomer, listCustomers, saveCustomer } from './services/customers'
import { commitImport } from './services/importer'
import * as alterations from './services/alterations'
import { appInfo, mySalesToday } from './services/settings'
import * as returns from './services/returns'
import * as stickers from './services/stickers'
import * as admin from './services/admin'
import * as reports from './services/reports'
import { exportExcel, exportPdf } from './reportExport'
import { listPrinters, printDayEnd, openDrawer, printAlteration, printReceipt, printStickers, testReceipt, testSticker } from './print'
import { restoreFromFile, restoreListed } from './restore'
import * as stock from './services/stock'
import { pieceHistory } from './services/serials'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * One handler per renderer call. The renderer never touches SQLite or Node; it only
 * calls these. Errors thrown by services reach the UI as readable messages.
 * Add new domains (bills, ...) as more `h(...)` lines.
 */
function h<A extends unknown[], R>(channel: string, fn: (...a: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (_e, ...args): Promise<Result<R>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' }
    }
  })
}

export function registerIpc(): void {
  h('app:info', appInfo)
  h('app:mySales', mySalesToday)
  h('auth:staff', listActiveStaff)
  h('auth:login', login)
  h('auth:changePin', changePin)
  h('auth:logout', logout)

  h('cat:categories', cat.listCategories)
  h('cat:addCategory', cat.createCategory)
  h('cat:products', cat.listProducts)
  h('cat:product', cat.getProduct)
  h('cat:create', cat.createProduct)
  h('cat:update', cat.updateProduct)
  h('cat:prices', cat.updatePrices)
  h('cat:brandBarcode', cat.setBrandBarcode)
  h('cat:trackSerials', cat.setTrackSerials)
  h('cat:archive', cat.archiveProduct)
  h('cat:restore', cat.restoreProduct)

  h('cat:photos', cat.listProductPhotos)
  h('cat:setColourPhoto', cat.setColourPhoto)
  h('cat:removePhoto', cat.removeColourPhoto)
  h('photo:save', cat.savePhotoBytes)

  h('billing:context', billing.billingContext)
  h('billing:search', billing.sellableSearch)
  h('billing:archived', billing.archivedMatches)
  h('billing:scanPiece', billing.scanPiece)
  h('billing:makeBunch', billing.makeBunch)
  h('billing:variants', billing.sellableByIds)
  h('billing:photo', cat.variantPhoto)
  h('billing:openDay', billing.openDay)
  h('billing:create', (i: Parameters<typeof billing.createBill>[0]) => billing.createBill(i)) // one argument only: the internals parameter is for the main process
  h('billing:bill', billing.getBill)
  h('billing:hold', billing.holdBill)
  h('billing:held', billing.listHeld)
  h('billing:resume', billing.resumeHeld)
  h('alt:list', alterations.listAlterations)
  h('alt:byBill', alterations.jobsByBill)
  h('alt:context', alterations.alterationContext)
  h('alt:customer', alterations.findAltCustomer)
  h('alt:garments', alterations.customerGarments)
  h('alt:create', alterations.createAlteration)
  h('alt:advance', alterations.advanceAlteration)
  h('alt:deliver', alterations.deliverAlteration)
  h('alt:saveTailor', alterations.saveTailor)
  h('alt:saveConfig', alterations.saveAlterationConfig)
  h('reports:get', reports.getReport)
  h('reports:exportExcel', exportExcel)
  h('reports:exportPdf', exportPdf)
  h('settings:get', admin.getAllSettings)
  h('settings:saveShop', admin.saveShop)
  h('settings:saveGst', admin.saveGst)
  h('settings:saveReceipt', admin.saveReceipt)
  h('settings:savePrinters', admin.savePrinters)
  h('settings:saveCoins', admin.saveCoins)
  h('settings:staff', admin.listStaffAdmin)
  h('settings:saveStaff', admin.saveStaff)
  h('settings:setPin', admin.setStaffPin)
  h('settings:backups', admin.backupInfo)
  h('settings:saveBackupFolder', admin.saveBackupFolder)
  h('settings:finishSetup', admin.finishSetup)
  h('settings:backupNow', admin.backupNow)
  h('settings:restore', restoreListed)
  h('settings:restoreFromFile', restoreFromFile)
  h('print:receipt', printReceipt)
  h('print:alteration', printAlteration)
  h('print:testReceipt', testReceipt)
  h('print:testSticker', testSticker)
  h('print:openDrawer', openDrawer)
  h('stickers:context', stickers.stickerContext)
  h('stickers:items', stickers.stickerItems)
  h('stickers:lastPurchase', stickers.lastPurchaseItems)
  h('stickers:stock', stickers.stockItems)
  h('stickers:piece', stickers.pieceSticker)
  h('stickers:printers', listPrinters)
  h('stickers:savePrefs', stickers.saveStickerPrefs)
  h('stickers:print', printStickers)
  h('bills:list', bills.listBills)
  h('bills:detail', bills.billDetail)
  h('bills:cancel', bills.cancelBill)
  h('returns:find', returns.findBillsForReturn)
  h('returns:bill', returns.getBillForReturn)
  h('returns:do', returns.doReturn)
  h('returns:creditNotes', returns.usableCreditNotes)
  h('day:summary', daySummary)
  h('day:addExpense', addExpense)
  h('day:close', closeDay)
  h('print:dayEnd', printDayEnd)

  h('customers:list', listCustomers)
  h('customers:get', getCustomer)
  h('customers:save', saveCustomer)
  h('customers:delete', deleteCustomer)
  h('customers:today', celebrationsToday)
  h('customer:find', findCustomerByMobile)
  h('customer:create', createCustomer)

  h('import:template', saveImportTemplate)
  h('import:choose', chooseImportFile)
  h('import:commit', commitImport)

  h('stock:search', stock.searchVariants)
  h('stock:scanPiece', stock.scanPiece)
  h('stock:levels', stock.stockLevels)
  h('stock:history', stock.stockHistory)
  h('stock:suppliers', stock.listSuppliers)
  h('stock:addSupplier', stock.createSupplier)
  h('stock:in', stock.stockIn)
  h('stock:recent', stock.recentPurchases)
  h('stock:out', stock.stockOut)
  h('stock:adjust', stock.adjustStock)
  h('stock:moves', stock.recentMoves)
  h('count:get', stock.getOpenCount)
  h('count:start', stock.startCount)
  h('count:scan', stock.countScan)
  h('count:set', stock.countSet)
  h('count:discard', stock.discardCount)
  h('count:approve', stock.approveCount)
  h('app:approvers', listApprovers)
  h('serials:history', pieceHistory)
}
