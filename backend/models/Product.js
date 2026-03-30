const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  description: { type: String, default: '' },
  category: { type: String, default: 'Pure Silk Paithani', trim: true },
  familyGroup: { type: String, default: '', trim: true, enum: ['', 'Children', 'Parents', 'Grandparents'] },
  image: { type: String, default: '' },
  sku: { type: String, default: '', trim: true },
  status: { type: String, default: 'available', enum: ['available', 'new', 'preorder', 'soldout'] },
  stock: { type: Number, default: 0, min: 0 },
  lowStockThreshold: { type: Number, default: 2, min: 0 },
  discountType: { type: String, default: 'none', enum: ['none', 'percent', 'flat'] },
  discountValue: { type: Number, default: 0, min: 0 },
  featured: { type: Boolean, default: false },
  dateAdded: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', productSchema);
