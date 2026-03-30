const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  key: { type: String, required: true },
  id: { type: String, default: '' },
  sku: { type: String, default: '' },
  name: { type: String, required: true },
  image: { type: String, default: '' },
  qty: { type: Number, default: 1 },
  basePrice: { type: Number, default: 0 },
  addonsTotal: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  customizations: { type: [String], default: [] },
  notes: { type: String, default: '' }
}, { _id: false });

const cartSchema = new mongoose.Schema({
  cartId: { type: String, required: true, unique: true },
  items: { type: [cartItemSchema], default: [] },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Cart', cartSchema);
