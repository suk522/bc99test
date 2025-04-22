const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const User = require('./models/User');
const Transaction = require('./models/Transaction');
const Withdrawal = require('./models/Withdrawal');
const WithdrawalCounter = require('./models/Withdrawal').WithdrawalCounter;
const Deposit = require('./models/Deposit');
const DepositCounter = require('./models/Deposit').DepositCounter;
const QRCode = require('qrcode');

const app = express();

async function generateNote() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  
  for (let i = 0; i < 5; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }
  
  return result;
}
app.use(expressLayouts);
app.set('layout', 'layout');
app.use('/attached_assets', express.static('attached_assets'));

// Connect to MongoDB
mongoose.connect('mongodb+srv://sukhdevgodara964:KDKUc5zk70RNaJ5X@cluster0.ejnvmdj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
};

// Routes
app.get('/', (req, res) => {
  res.redirect('/home');
});

app.get('/home', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);
  res.render('home', { user, path: '/home' });
});

app.get('/activity', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);
  res.render('activity', { user, path: '/activity' });
});

app.get('/wallet', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);
  const transactions = await Transaction.find({ userId: user._id }).sort({ date: -1 });
  const deposits = await Deposit.find({ userId: user._id }).sort({ date: -1 });
  const withdrawals = await Withdrawal.find({ userId: user._id }).sort({ date: -1 });
  res.render('wallet', { user, transactions, deposits, withdrawals, path: '/wallet' });
});

app.post('/wallet/deposit', isAuthenticated, async (req, res) => {
  try {
    const { amount, note, utr } = req.body;
    
    const counter = await DepositCounter.findByIdAndUpdate(
      'depositId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const orderNumber = String(counter.seq).padStart(8, '0');
    
    const deposit = new Deposit({
      userId: req.session.user._id,
      orderNumber,
      amount: Number(amount),
      note,
      utr,
      status: 'pending'
    });
    await deposit.save();

    const transaction = new Transaction({
      userId: req.session.user._id,
      type: 'deposit',
      amount: Number(amount),
      status: 'pending'
    });
    await transaction.save();

    res.redirect('/wallet');
  } catch (error) {
    res.status(400).send('Error processing deposit');
  }
});

app.get('/wallet/balance', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.user._id);
    res.json({ balance: user.balance });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching balance' });
  }
});

app.post('/wallet/withdraw', isAuthenticated, async (req, res) => {
  try {
    const { amount, accountNumber, ifscCode, holderName } = req.body;
    const user = await User.findById(req.session.user._id);

    // Check and reduce balance immediately
    if (user.balance < amount) {
      return res.status(400).send('Insufficient balance');
    }
    
    user.balance -= amount;
    await user.save();

    // Save bank details if not already saved
    if (!user.bankDetails?.accountNumber && accountNumber) {
      user.bankDetails = { accountNumber, ifscCode, holderName };
      await user.save();
    }

    const counter = await WithdrawalCounter.findByIdAndUpdate(
      'withdrawalId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const orderNumber = String(counter.seq).padStart(8, '0');
    
    const withdrawal = new Withdrawal({
      userId: user._id,
      orderNumber,
      amount,
      bankDetails: user.bankDetails,
      status: 'pending'
    });
    await withdrawal.save();

    const transaction = new Transaction({
      userId: user._id,
      type: 'withdraw',
      amount,
      status: 'pending'
    });
    await transaction.save();

    // Don't reduce balance until withdrawal is approved
    res.redirect('/wallet');
  } catch (error) {
    res.status(400).send('Error processing withdrawal');
  }
});

app.get('/login', (req, res) => {
  res.render('login', { path: req.path });
});

app.get('/register', (req, res) => {
  res.render('register', { path: req.path });
});

app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = new User({ username, password });
    await user.save();
    res.redirect('/login');
  } catch (error) {
    res.status(400).send('Error registering user');
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (user && user.password === password) {
      if (user.banned) {
        return res.status(403).send('Account has been banned');
      }
      req.session.user = user;
      res.redirect('/');
    } else {
      res.redirect('/login');
    }
  } catch (error) {
    res.status(400).send('Error logging in');
  }
});

// Admin middleware
const isAdmin = (req, res, next) => {
  if (req.session.isAdmin === true) {
    next();
  } else {
    res.redirect('/admin-login');
  }
};

app.get('/admin-login', (req, res) => {
  if (req.session.isAdmin === true) {
    return res.redirect('/admin');
  }
  res.render('admin-login', { query: req.query, path: req.path });
});

app.post('/admin-login', (req, res) => {
  const { username, password } = req.body;
  console.log('Admin login attempt - password:', password);

  if (username === 'admin' && password === '123') {
    req.session.isAdmin = true;
    console.log('Setting admin session:', req.session.isAdmin);
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.redirect('/admin-login?error=1');
      }
      res.redirect('/admin');
    });
  } else {
    res.redirect('/admin-login?error=1');
  }
});

app.get('/wallet/generate-qr', isAuthenticated, async (req, res) => {
  const amount = req.query.amount;
  const note = await generateNote();
  const upiString = `upi://pay?pa=sukd738@ybl&pn=Deposit&am=${amount}&tn=${note}`;
  const qrCode = await QRCode.toDataURL(upiString);
  res.json({ qrCode, note: note.toString() });
});

// Create deposit order
app.post('/wallet/create-deposit', isAuthenticated, async (req, res) => {
  try {
    const { amount, note } = req.body;
    
    const counter = await DepositCounter.findByIdAndUpdate(
      'depositId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const orderNumber = String(counter.seq).padStart(8, '0');
    
    const deposit = new Deposit({
      userId: req.session.user._id,
      orderNumber,
      amount: Number(amount),
      note,
      status: 'initiated'
    });
    await deposit.save();

    res.json({ success: true, orderId: deposit._id });
  } catch (error) {
    res.status(400).json({ error: 'Error creating deposit order' });
  }
});

// Update deposit with UTR
app.post('/wallet/deposit', isAuthenticated, async (req, res) => {
  try {
    const { orderId, utr } = req.body;
    
    // Validate UTR format
    if (!utr.match(/^\d{12}$/)) {
      return res.status(400).send('UTR must be 12 digits');
    }

    // Check for duplicate UTR
    const existingUTR = await Deposit.findOne({ utr });
    if (existingUTR) {
      return res.status(400).send('This UTR has already been used');
    }

    // Update deposit with UTR
    await Deposit.findByIdAndUpdate(orderId, {
      utr,
      status: 'pending'
    });

    res.redirect('/wallet');
  } catch (error) {
    res.status(400).send('Error processing deposit');
  }
});

app.get('/admin', isAdmin, async (req, res) => {
  console.log('Admin session check:', req.session.isAdmin);
  const users = await User.find();
  const withdrawals = await Withdrawal.find().populate('userId');
  const deposits = await Deposit.find().populate({
    path: 'userId',
    select: 'username uid'
  });
  const transactions = await Transaction.find().populate('userId');
  res.render('admin', { users, withdrawals, deposits, transactions, path: req.path });
});

app.post('/admin/deposit/:id/:action', isAdmin, async (req, res) => {
  try {
    const { id, action } = req.params;
    const deposit = await Deposit.findById(id);
    const user = await User.findById(deposit.userId);

    if (action === 'success') {
      deposit.status = 'success';
      user.balance += deposit.amount;
      await user.save();
      
      // Update existing pending transaction
      await Transaction.findOneAndUpdate(
        { userId: user._id, type: 'deposit', amount: deposit.amount, status: 'pending' },
        { status: 'completed' }
      );
    } else if (action === 'failed') {
      deposit.status = 'failed';
    }
    
    await deposit.save();
    res.redirect('/admin');
  } catch (error) {
    res.status(400).send('Error processing deposit action');
  }
});

app.post('/admin/withdrawal/:id/:action', isAdmin, async (req, res) => {
  try {
    const { id, action } = req.params;
    const withdrawal = await Withdrawal.findById(id);
    const user = await User.findById(withdrawal.userId);

    if (action === 'approve') {
      withdrawal.status = 'approved';
      await Transaction.findOneAndUpdate(
          { userId: user._id, type: 'withdraw', status: 'pending' },
          { status: 'completed' }
      );
    } else if (action === 'reject') {
      withdrawal.status = 'rejected';
      // Refund the balance when rejecting withdrawal
      user.balance += withdrawal.amount;
      await user.save();
      await Transaction.findOneAndUpdate(
        { userId: user._id, type: 'withdraw', status: 'pending' },
        { status: 'rejected' }
      );
    }
    
    await withdrawal.save();
    res.redirect('/admin');
  } catch (error) {
    res.status(400).send('Error processing withdrawal action');
  }
});

app.post('/admin/edit-user/:id', isAdmin, async (req, res) => {
  try {
    const { username, balance } = req.body;
    await User.findByIdAndUpdate(req.params.id, { username, balance });
    res.redirect('/admin');
  } catch (error) {
    res.status(400).send('Error updating user');
  }
});

app.post('/admin/toggle-ban/:id', isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    user.banned = !user.banned;
    await user.save();
    res.redirect('/admin');
  } catch (error) {
    res.status(400).send('Error toggling ban status');
  }
});

app.get('/account', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.user._id);
    res.render('account', { user, path: req.path });
  } catch (error) {
    res.status(400).send('Error loading account');
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});