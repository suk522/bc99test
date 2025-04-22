
const mongoose = require('mongoose');

const depositCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

const depositSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderNumber: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  note: { type: String, required: true },
  utr: { type: String, required: true },
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
  date: { type: Date, default: Date.now }
});

const DepositCounter = mongoose.model('DepositCounter', depositCounterSchema);
const Deposit = mongoose.model('Deposit', depositSchema);

module.exports = Deposit;
module.exports.DepositCounter = DepositCounter;
