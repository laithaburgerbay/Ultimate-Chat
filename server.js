
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// --- SQLite Setup ---
const db = new sqlite3.Database('chat.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room TEXT,
    user TEXT,
    avatar TEXT,
    text TEXT,
    time TEXT,
    reactions TEXT DEFAULT '{}'
  )`);
});

// Utility
const nowTime = () => new Date().toLocaleTimeString();
const msgId = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

// Memory map of users by socket -> {name, room, avatar}
const users = new Map();

// REST: health
app.get('/health', (_, res) => res.json({ ok: true }));

io.on('connection', (socket) => {
  // Join a room with nickname
  socket.on('join', ({ room, name }) => {
    if (!room) room = 'general';
    if (!name) name = 'Anonymous';
    const avatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`;

    // leave previous
    const current = users.get(socket.id);
    if (current?.room) socket.leave(current.room);

    users.set(socket.id, { name, room, avatar });
    socket.join(room);

    // Send last 100 messages from the room
    db.all(`SELECT * FROM messages WHERE room = ? ORDER BY rowid DESC LIMIT 100`, [room], (err, rows) => {
      if (!err && rows) {
        rows.reverse().forEach(row => {
          socket.emit('message', {
            id: row.id,
            room: row.room,
            user: row.user,
            avatar: row.avatar,
            text: row.text,
            time: row.time,
            reactions: JSON.parse(row.reactions || '{}')
          });
        });
      }
      // Notify join
      io.to(room).emit('system', `${name} joined #${room}`);
      // Update user list
      emitUsers(room);
    });
  });

  // Chat message
  socket.on('message', (text) => {
    const u = users.get(socket.id);
    if (!u || !u.room) return;
    if (!text || String(text).trim().length === 0) return;

    const data = {
      id: msgId(),
      room: u.room,
      user: u.name,
      avatar: u.avatar,
      text: String(text).slice(0, 1000),
      time: nowTime(),
      reactions: {}
    };

    db.run(`INSERT INTO messages(id, room, user, avatar, text, time, reactions) VALUES (?,?,?,?,?,?,?)`,
      [data.id, data.room, data.user, data.avatar, data.text, data.time, JSON.stringify({})]);

    io.to(u.room).emit('message', data);
  });

  // Typing indicator
  socket.on('typing', (isTyping) => {
    const u = users.get(socket.id);
    if (!u || !u.room) return;
    socket.to(u.room).emit('typing', { user: u.name, status: !!isTyping });
  });

  // Reactions
  socket.on('react', ({ messageId, reaction }) => {
    const u = users.get(socket.id);
    if (!u || !u.room || !messageId || !reaction) return;

    db.get(`SELECT reactions FROM messages WHERE id = ?`, [messageId], (err, row) => {
      let reactions = {};
      if (row && row.reactions) {
        try { reactions = JSON.parse(row.reactions); } catch {}
      }
      reactions[reaction] = (reactions[reaction] || 0) + 1;
      db.run(`UPDATE messages SET reactions = ? WHERE id = ?`, [JSON.stringify(reactions), messageId]);
      io.to(u.room).emit('reaction', { messageId, reactions });
    });
  });

  // Switch rooms
  socket.on('switchRoom', (room) => {
    const u = users.get(socket.id);
    if (!u) return;
    const oldRoom = u.room;
    if (oldRoom) {
      socket.leave(oldRoom);
      io.to(oldRoom).emit('system', `${u.name} left #${oldRoom}`);
      emitUsers(oldRoom);
    }
    users.set(socket.id, { ...u, room });
    socket.join(room);
    socket.emit('system', `You joined #${room}`);
    emitUsers(room);
    db.all(`SELECT * FROM messages WHERE room = ? ORDER BY rowid DESC LIMIT 100`, [room], (err, rows) => {
      if (!err && rows) {
        rows.reverse().forEach(row => {
          socket.emit('message', {
            id: row.id, room: row.room, user: row.user, avatar: row.avatar,
            text: row.text, time: row.time, reactions: JSON.parse(row.reactions || '{}')
          });
        });
      }
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const u = users.get(socket.id);
    if (u?.room) {
      io.to(u.room).emit('system', `${u.name} disconnected`);
      users.delete(socket.id);
      emitUsers(u.room);
    }
  });

  function emitUsers(room) {
    const list = [];
    for (const [_, val] of users) if (val.room === room) list.push({ name: val.name, avatar: val.avatar });
    io.to(room).emit('users', list);
  }
});

server.listen(PORT, () => {
  console.log(`Ultimate chat app listening on :${PORT}`);
});
