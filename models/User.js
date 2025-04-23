const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  mobile: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  uid: { type: String, unique: true },
  banned: { type: Boolean, default: false },
  bankDetails: {
    accountNumber: String,
    ifscCode: String, 
    holderName: String
  }
});

userSchema.pre('save', function(next) {
  if (!this.uid) {
    this.uid = Math.floor(100000 + Math.random() * 900000).toString();
  }
  next();
});

module.exports = mongoose.model('User', userSchema);