const TelegramBot = require('node-telegram-bot-api');
const xmpp = require('node-xmpp-client');
const crypto = require('crypto');
require('dotenv').config();

// Configuration
const token = process.env.TELEGRAM_BOT_TOKEN;
const telegramBot = new TelegramBot(token, { polling: true });

const USERS = {
  'markaz': {
    jabberJid: process.env.USER_MARKAZ_JID,
    jabberPassword: process.env.USER_MARKAZ_JABBERPASSWORD,
    password: process.env.USER_MARKAZ_PASSWORD,
    balance: 100000,
  },
  'admin': {
    jabberJid: process.env.USER_ADMIN_JID,
    jabberPassword: process.env.USER_ADMIN_JABBERPASSWORD,
    password: process.env.USER_ADMIN_PASSWORD,
    balance: 50000,
  },
};

const ADMINS = {
  'udin123': {
    password: process.env.USER_UDIN123_PASSWORD,
    chatId: process.env.USER_UDIN123_CHAT_ID,
  },
};

let loggedInUsers = new Map();
let loggedInAdmins = new Map();
const topUpTokens = {};
const transactionHistory = [];
const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// Utility functions
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function addBalance(username, amount) {
  if (!USERS[username]) {
    throw new Error('User not found');
  }
  USERS[username].balance += amount;
}

function createTopUpToken(username, amount) {
  if (!USERS[username]) {
    throw new Error('User not found');
  }
  if (amount <= 0) {
    throw new Error('Amount must be positive');
  }
  const token = generateToken();
  topUpTokens[token] = { username, amount, used: false, createdAt: Date.now() };
  return token;
}

function useTopUpToken(token) {
  const topUp = topUpTokens[token];
  if (topUp) {
    if (topUp.used) {
      throw new Error('Token has already been used');
    }
    if (Date.now() - topUp.createdAt > TOKEN_EXPIRY_MS) {
      throw new Error('Token has expired');
    }
    addBalance(topUp.username, topUp.amount);
    topUp.used = true;
    return `Top-up successful. Added ${topUp.amount} to ${topUp.username}.`;
  } else {
    throw new Error('Invalid token');
  }
}

// Define product codes and prices
const PRODUCTS = {
  'dana10': { code: 'dana10', name: 'dana10', price: 10000 },
  'dana20': { code: 'dana20', name: 'dana20', price: 20000 },
  'dana30': { code: 'dana30', name: 'dana30', price: 30000 },
  'dana50': { code: 'dana50', name: 'dana50', price: 50000 },
  'dana100': { code: 'dana100', name: 'dana100', price: 100000 },
  'dana44': { code: 'dana44', name: 'dana44', price: 44000 },
};

// Create Jabber client
function createJabberClient(userKey, chatId) {
  const user = USERS[userKey];
  if (!user) {
    console.error(`User ${userKey} not found in USERS.`);
    return;
  }

  const { jabberJid, jabberPassword } = user;
  const client = new xmpp.Client({
    jid: jabberJid,
    password: jabberPassword,
    host: 'xmpp.cz',
    port: 5222,
  });

  client.on('online', () => {
    console.log(`Connected to Jabber as ${jabberJid}`);
    client.send(new xmpp.Element('presence', {}).c('show').t('chat'));
  });

  client.on('stanza', (stanza) => {
    if (stanza.is('message') && stanza.getChild('body')) {
      const jabberMessage = stanza.getChild('body').getText();
      telegramBot.sendMessage(chatId, jabberMessage).catch(err => console.error(`Error sending message to Telegram: ${err}`));
      console.log(`Message from Jabber sent to chatId ${chatId}: ${jabberMessage}`);
    }
  });

  client.on('error', (err) => {
    console.error(`Jabber client error for ${jabberJid}:`, err);
  });

  return client;
}

// Handle incoming messages from Telegram
telegramBot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text.trim();

  console.log(`Received message from chatId ${chatId}: ${messageText}`);

  if (messageText === '/start') {
    const welcomeMessage = `🌟 Selamat datang di Bot PT Putra Bungsu! 🌟\n\n` +
                           `Kami siap membantu Anda dengan registrasi akun dan transaksi pulsa dengan mudah.\n\n` +
                           `📝 Registrasi Akun:\n` +
                           `/register <username> <password> <jabberJid> <jabberPassword>\n` +
                           `Contoh: /register markaz 123456 dfasdf1234@xmpp.cz 123456\n\n` +
                           `🔑 Login:\n` +
                           `/login <username> <password>\n` +
                           `Contoh: /login markaz 123456\n\n` +
                           `ℹ️ Informasi Transaksi:\n` +
                           `💸 Transaksi:\n` +
                           `Transaksi: <produk>.<nomor>.<pin>\n` +
                           `Contoh: Transaksi: pulsa.081234567890.123456\n\n` +
                           `💸 Cek Produk:\n` +
                           `/products\n` +
                           `Contoh: /products\n\n` +
                           `🚪 Logout:\n` +
                           `/logout\n` +
                           `Contoh: /logout`;
    telegramBot.sendMessage(chatId, welcomeMessage).catch(err => console.error(`Error sending welcome message to Telegram: ${err}`));

  } else if (messageText.startsWith('/login')) {
    handleLoginCommand(chatId, messageText);

  } else if (messageText.startsWith('/balance')) {
    handleBalanceCommand(chatId, messageText);

  } else if (messageText.startsWith('/adminLogin')) {
    handleAdminLogin(chatId, messageText);

  } else if (messageText === '/adminLogout') {
    handleAdminLogout(chatId);

  } else if (messageText === '/viewBalanceReport') {
    handleViewBalanceReport(chatId);

  } else if (messageText === '/viewTransactionReport') {
    handleViewTransactionReport(chatId);

  } else if (messageText === '/logout') {  
    handleLogoutCommand(chatId);

  } else if (messageText === '/products') {
    const productList = listProducts();
    telegramBot.sendMessage(chatId, productList).catch(err => console.error(`Error sending message to Telegram: ${err}`));

  } else {
    telegramBot.sendMessage(chatId, 'Invalid command.').catch(err => console.error(`Error sending message to Telegram: ${err}`));
  }
});

function handleLoginCommand(chatId, messageText) {
  const args = messageText.split(' ');
  if (args.length !== 3) {
    telegramBot.sendMessage(chatId, 'Usage: /login <username> <password>').catch(err => console.error(`Error sending message to Telegram: ${err}`));
    return;
  }

  bot.onText(/\/products/, (msg) => {
    const chatId = msg.chat.id;
    // Assuming `productList` is an array of products
    const productList = [
        { code: 'dana10', name: 'Dana 10', price: 10000 },
        { code: 'dana20', name: 'Dana 20', price: 20000 }
        // Add other products here
    ];
    
    let response = 'Available products:\n';
    productList.forEach(product => {
        response += `${product.code} - ${product.name} - ${product.price}\n`;
    });

    bot.sendMessage(chatId, response);
});

bot.onText(/h\.(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const command = match[1]; // This will be the part after "h."

    // Handle different commands like balance checks or transactions
    if (command.startsWith('dana')) {
        const [productCode, transactionId, pin] = command.split('.');
        // Validate and process transaction
        // Send transaction details to the appropriate service
        bot.sendMessage(chatId, `Processing transaction for ${productCode} with ID ${transactionId} and PIN ${pin}`);
    } else if (command.startsWith('balance')) {
        const adminCode = command.split(' ')[1];
        if (adminCode === 'admin') {
            // Fetch and send balance information
            bot.sendMessage(chatId, `Fetching balance for admin...`);
        } else {
            bot.sendMessage(chatId, `Invalid admin code.`);
        }
    } else {
        bot.sendMessage(chatId, `Invalid command.`);
    }
});




  const [, username, password] = args;
  const user = USERS[username];

  if (!user || user.password !== password) {
    telegramBot.sendMessage(chatId, 'Invalid username or password.').catch(err => console.error(`Error sending message to Telegram: ${err}`));
    return;
  }

  if (loggedInUsers.has(chatId)) {
    telegramBot.sendMessage(chatId, 'You are already logged in.').catch(err => console.error(`Error sending message to Telegram: ${err}`));
    return;
  }

  const jabberClient = createJabberClient(username, user.jabberPassword, chatId);
  loggedInUsers.set(chatId, { username, jabberClient });
  telegramBot.sendMessage(chatId, `Logged in as ${username}.`).catch(err => console.error(`Error sending message to Telegram: ${err}`));
}

function handleBalanceCommand(chatId, messageText) {
  const args = messageText.split(' ');
  if (args.length !== 2) {
    telegramBot.sendMessage(chatId, 'Usage: /balance <username>').catch(err => console.error(`Error sending message to Telegram: ${err}`));
    return;
  }

  const [, username] = args;
  const user = USERS[username];

  if (!user) {
    telegramBot.sendMessage(chatId, 'User not found.').catch(err => console.error(`Error sending message to Telegram: ${err}`));
    return;
  }

  telegramBot.sendMessage(chatId, `The balance for ${username} is Rp${user.balance}.`).catch(err => console.error(`Error sending message to Telegram: ${err}`));
}

