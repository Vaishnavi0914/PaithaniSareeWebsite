const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
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

const trackingSchema = new mongoose.Schema({
  carrier: { type: String, default: '' },
  trackingNumber: { type: String, default: '' },
  trackingUrl: { type: String, default: '' }
}, { _id: false });

const statusHistorySchema = new mongoose.Schema({
  status: { type: String, required: true, trim: true },
  note: { type: String, default: '' },
  at: { type: Date, default: Date.now },
  by: { type: String, default: '' }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  userId: { type: String, default: '' },
  cartId: { type: String, default: '' },
  customer: {
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: { type: String, default: '' }
  },
  items: { type: [orderItemSchema], default: [] },
  subtotalAmount: { type: Number, default: 0 },
  shippingAmount: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 },
  status: {
    type: String,
    default: 'placed',
    enum: ['placed', 'paid', 'packed', 'shipped', 'delivered', 'returned', 'refunded', 'cancelled']
  },
  statusHistory: { type: [statusHistorySchema], default: [] },
  tracking: { type: trackingSchema, default: () => ({}) },
  packedAt: { type: Date },
  shippedAt: { type: Date },
  deliveredAt: { type: Date },
  returnedAt: { type: Date },
  refundedAt: { type: Date },
  cancelledAt: { type: Date },
  payment: {
    provider: { type: String, default: '' },
    status: { type: String, default: 'pending' }, // pending | paid | failed | refunded
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    orderId: { type: String, default: '' },
    paymentId: { type: String, default: '' },
    signature: { type: String, default: '' },
    receipt: { type: String, default: '' },
    verifiedAt: { type: Date }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);
