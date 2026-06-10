/** F0 probe'dan türetilmiş örnek — test/fixture amaçlı */
export const TGO_GROCERY_PACKAGE_FIXTURE = {
  id: '1000255008876',
  orderId: '900001',
  orderNumber: '11308158497',
  sellerId: 862084,
  storeId: 223508,
  customer: {
    fullName: 'Test Musteri',
    phone: '5320001122'
  },
  packageStatus: 'Delivered',
  deliveryModel: 'GO',
  grossAmount: 1625,
  totalPrice: 1495.34,
  orderDate: 1717000000000,
  lines: [
    {
      amount: 1625,
      price: 1625,
      barcode: '3182550737593',
      product: {
        name: 'Sterilised 37 Kedi Kuru Mamasi 2 Kg',
        productSaleName: 'Sterilised 37 Kedi Kuru Mamasi 2 Kg',
        brandName: 'Royal Canin'
      },
      items: [{ id: '20001635753458', isCancelled: false }]
    }
  ]
};

export const TGO_ACTIVE_PACKAGE_FIXTURE = {
  ...TGO_GROCERY_PACKAGE_FIXTURE,
  id: '1000255009999',
  orderNumber: '11308159999',
  packageStatus: 'Picking',
  orderDate: Date.now()
};
