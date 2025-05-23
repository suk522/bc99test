const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const compression = require('compression');
const morgan = require('morgan');

// Performance monitoring middleware
function requestDuration(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) { // Log if request takes more than 1 second
      console.warn(`Slow request: ${req.method} ${req.url} took ${duration}ms`);
    }
  });
  next();
}
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
// Session middleware must come before other middleware that uses session
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(expressLayouts);
app.set('layout', 'layout');
// Enable compression
app.use(compression());
app.use(requestDuration);
app.use(morgan('tiny'));

// Static file serving with caching
const staticOptions = {
  maxAge: '1d',
  etag: true
};
app.use(express.static('public', staticOptions));
app.use('/attached_assets', express.static('attached_assets', staticOptions));
app.set('view engine', 'ejs');

// Add user and path middleware after session is initialized
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  next();
});

// Connect to MongoDB
mongoose.connect('mongodb+srv://sukhdevgodara964:KDKUc5zk70RNaJ5X@cluster0.ejnvmdj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
// Session middleware already initialized at the top

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
  const user = await User.findById(req.session.user._id).select('username balance uid');
  const [transactions, deposits, withdrawals] = await Promise.all([
    Transaction.find({ userId: user._id }).select('type amount status date').sort({ date: -1 }).limit(50),
    Deposit.find({ userId: user._id }).select('amount status date orderNumber').sort({ date: -1 }).limit(50),
    Withdrawal.find({ userId: user._id }).select('amount status date orderNumber').sort({ date: -1 }).limit(50)
  ]);
  res.render('wallet', { user, transactions, deposits, withdrawals, path: '/wallet' });
});

app.post('/wallet/deposit', isAuthenticated, async (req, res) => {
  try {
    const { amount, note, utr, orderId } = req.body;
    if (!amount || !utr || !orderId) {
      return res.status(400).send('Missing required fields');
    }

    // Validate amount
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).send('Invalid amount');
    }

    const counter = await DepositCounter.findByIdAndUpdate(
      'depositId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const orderNumber = 'D' + String(counter.seq).padStart(7, '0');

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
      orderNumber: deposit.orderNumber,
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

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).send('Invalid amount');
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount)) {
      return res.status(400).send('Amount must be a number');
    }

    const user = await User.findOneAndUpdate(
      { 
        _id: req.session.user._id,
        balance: { $gte: numAmount }
      },
      { $inc: { balance: -numAmount } },
      { new: true }
    );

    if (!user) {
      return res.status(400).send('Insufficient balance');
    }

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
    const orderNumber = 'W' + String(counter.seq).padStart(7, '0');

    const withdrawalCounter = await WithdrawalCounter.findByIdAndUpdate(
      'withdrawalId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const orderNumber = 'W' + String(withdrawalCounter.seq).padStart(7, '0');

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
      orderNumber,
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
  res.render('login', { path: req.path, error: req.query.error });
});

app.get('/register', (req, res) => {
  res.render('register', { path: req.path });
});

app.post('/register', async (req, res) => {
  try {
    const { mobile, password } = req.body;
    if (!mobile || !password || !/^\d{10}$/.test(mobile)) {
      return res.render('register', { error: 'Valid mobile number and password are required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return res.render('register', { error: 'Mobile number already registered' });
    }

    const user = new User({ mobile, password });
    await user.save();
    res.redirect('/login');
  } catch (error) {
    console.error('Registration error:', error);
    res.render('register', { error: 'An error occurred during registration' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { mobile, password } = req.body;

    if (!mobile || !password || !/^\d{10}$/.test(mobile)) {
      return res.render('login', { error: 'Valid mobile number and password are required' });
    }

    const user = await User.findOne({ mobile });

    if (!user) {
      return res.render('login', { error: 'Invalid username or password' });
    }

    if (user.banned) {
      return res.render('login', { error: 'Account has been banned' });
    }

    if (user.password !== password) {
      return res.render('login', { error: 'Invalid username or password' });
    }

    req.session.user = user;
    res.redirect('/home');
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: 'An error occurred during login' });
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

    if (!amount || !note) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount < 100 || numAmount > 50000) {
      return res.status(400).json({ error: 'Invalid amount (Min: ₹100, Max: ₹50,000)' });
    }

    // Generate single order number
    const depositCounter = await DepositCounter.findByIdAndUpdate(
      'depositId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const orderNumber = 'D' + String(depositCounter.seq).padStart(7, '0');

    // Generate order number first
    const depositCounter = await DepositCounter.findByIdAndUpdate(
      'depositId',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const orderNumber = 'D' + String(depositCounter.seq).padStart(7, '0');

    // Create deposit first
    const deposit = new Deposit({
      userId: req.session.user._id,
      orderNumber: orderNumber,
      amount: Number(amount),
      note,
      status: 'pending',
      utr: ''
    });
    await deposit.save();

    // Create transaction with same order number
    const transaction = new Transaction({
      userId: req.session.user._id,
      type: 'deposit',
      amount: Number(amount),
      orderNumber: orderNumber,
      status: 'pending',
      date: new Date()
    });
    await transaction.save();

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

      // Update existing transaction
      await Transaction.findOneAndUpdate(
        { userId: user._id, orderNumber: deposit.orderNumber },
        { status: 'completed' }
      );
    } else if (action === 'failed') {
      deposit.status = 'failed';

      // Update existing transaction
      await Transaction.findOneAndUpdate(
        { userId: user._id, orderNumber: deposit.orderNumber },
        { status: 'rejected' }
      );
    }

    await deposit.save();
    res.redirect('/admin');
  } catch (error) {
    console.error('Error processing deposit action:', error);
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
          { userId: user._id, type: 'withdraw', orderNumber: withdrawal.orderNumber, status: 'pending' },
          { status: 'completed' }
      );
    } else if (action === 'reject') {
      withdrawal.status = 'rejected';
      // Refund the balance when rejecting withdrawal
      user.balance += withdrawal.amount;
      await user.save();
      await Transaction.findOneAndUpdate(
        { userId: user._id, type: 'withdraw', orderNumber: withdrawal.orderNumber, status: 'pending' },
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
let retries = 0;
const maxRetries = 3;

function startServer() {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retries < maxRetries) {
      retries++;
      console.log(`Port ${PORT} in use, retrying... (${retries}/${maxRetries})`);
      setTimeout(() => {
        server.close();
        startServer();
      }, 1000);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

startServer();