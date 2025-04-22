
const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 1 }
});

const Counter = mongoose.model('Counter', counterSchema);

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  uid: { type: String, unique: true },
  banned: { type: Boolean, default: false }
});

userSchema.pre('save', async function(next) {
  if (!this.uid) {
    const counter = await Counter.findByIdAndUpdate(
      'userId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    this.uid = String(counter.seq).padStart(6, '0');
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
