const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(helmet());
app.use(compression());
app.use(morgan('combined'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views/pages'));

// Routes
app.use('/', require('./routes/index'));
app.use('/api', require('./routes/api'));
app.use('/admin', require('./routes/admin'));
app.use('/portal', require('./routes/portal'));

// Captive portal detection routes (must be before catch-all)
app.use('/', require('./routes/captive'));

// Socket.io for real-time coin detection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('coin-inserted', (data) => {
    io.emit('coin-detected', data);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 PISOWifi Express server running on port ${PORT}`);
});

module.exports = { app, io };