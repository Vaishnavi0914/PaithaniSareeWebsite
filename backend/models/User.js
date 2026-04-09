const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const DEFAULT_BCRYPT_ROUNDS = 12;
const MAX_BCRYPT_ROUNDS = 14;
const MIN_BCRYPT_ROUNDS = 10;
const envRounds = Number(process.env.BCRYPT_SALT_ROUNDS);
const bcryptRounds = Number.isFinite(envRounds)
  ? Math.max(MIN_BCRYPT_ROUNDS, Math.min(MAX_BCRYPT_ROUNDS, Math.trunc(envRounds)))
  : DEFAULT_BCRYPT_ROUNDS;

const addressSchema = new mongoose.Schema({
  id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
  label: { type: String, default: '' },
  line: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  zip: { type: String, default: '' },
  country: { type: String, default: 'India' }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  phone: { type: String, default: '' },
  addresses: { type: [addressSchema], default: [] },
  defaultAddressId: { type: String, default: '' },
  isBlocked: { type: Boolean, default: false },
  blockedAt: { type: Date },
  emailVerified: { type: Boolean, default: false },
  emailVerifyTokenHash: { type: String, default: '' },
  emailVerifyExpires: { type: Date },
  resetPasswordTokenHash: { type: String, default: '' },
  resetPasswordExpires: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(bcryptRounds);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
