
const mongoose = require('mongoose');

const withdrawalCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

const WithdrawalCounter = mongoose.model('WithdrawalCounter', withdrawalCounterSchema);

const withdrawalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderNumber: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  bankDetails: {
    accountNumber: { type: String, required: true },
    ifscCode: { type: String, required: true },
    holderName: { type: String, required: true }
  },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
