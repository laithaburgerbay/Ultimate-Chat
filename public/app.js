const socket = io();
const $ = (s)=>document.querySelector(s);

const messages = $("#messages");
const users = $("#users");
const nickname = $("#nickname");
const room = $("#room");
const joinBtn = $("#join");
const input = $("#input");
const sendBtn = $("#send");
const picker = $("#picker");
const emojiBtn = $("#emojiBtn");
const typingEl = $("#typing");
const statusEl = $("#status");
const roomTitle = $("#roomTitle");
const themeToggle = $("#themeToggle");
const notifyToggle = $("#notifyToggle");

const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
if(localStorage.getItem('theme')==='dark' || (!localStorage.getItem('theme') && prefersDark)){
  document.body.classList.add('dark');
}
themeToggle.addEventListener('click',()=>{
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark':'light');
});

// Desktop notifications toggle
notifyToggle.addEventListener('change', async ()=>{
  if(notifyToggle.checked && Notification.permission !== 'granted'){
    try { await Notification.requestPermission(); } catch {}
  }
});

function notify(title, body){
  if(document.hasFocus()) return;
  if(Notification.permission==='granted' && notifyToggle.checked){
    new Notification(title, { body });
  }
}

// Join logic
joinBtn.addEventListener('click', ()=>{
  const nm = nickname.value.trim() || 'Anonymous';
  const rm = room.value.trim() || 'general';
  socket.emit('join', { room: rm, name: nm });
  roomTitle.textContent = `#${rm}`;
  messages.innerHTML = ""; // clear history
});

// Send message
function send(){
  const text = input.value.trim();
  if(!text) return;
  socket.emit('message', text);
  input.value='';
  socket.emit('typing', false);
}
sendBtn.addEventListener('click', send);
input.addEventListener('keydown', e=>{
  if(e.key==='Enter'){ e.preventDefault(); send(); }
});

// Typing
let typingTimer;
input.addEventListener('input', ()=>{
  socket.emit('typing', input.value.length>0);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(()=> socket.emit('typing', false), 1200);
});

// Emoji picker
emojiBtn.addEventListener('click', ()=>{
  picker.style.display = picker.style.display==='none' ? 'block' : 'none';
});
picker.addEventListener('emoji-click', e=>{
  input.value += e.detail.unicode;
  picker.style.display='none';
  input.focus();
});

// Render helpers
function addSystem(text){
  const div = document.createElement('div');
  div.className = 'system';
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

const messageMap = new Map(); // id -> react buttons
function renderMessage({id, user, avatar, text, time, reactions}, self=false){
  const wrap = document.createElement('div');
  wrap.className = 'msg' + (self ? ' self':'');

  const img = document.createElement('img');
  img.src = avatar; img.alt = user;
  img.width = 32; img.height = 32; img.style.borderRadius='50%';

  const body = document.createElement('div');
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${user} • ${time}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  const reacts = document.createElement('div');
  reacts.className = 'reactions';

  const choices = ['👍','❤️','😂','🔥','🎉'];
  function setButtons(){
    reacts.innerHTML='';
    choices.forEach(r => {
      const b = document.createElement('button');
      b.className = 'react';
      b.textContent = `${r}${reactions?.[r] ? ' ' + reactions[r] : ''}`;
      b.addEventListener('click', ()=> socket.emit('react', { messageId: id, reaction: r }));
      reacts.appendChild(b);
    });
  }
  setButtons();

  body.appendChild(meta);
  body.appendChild(bubble);
  body.appendChild(reacts);

  if (!self) wrap.appendChild(img);
  wrap.appendChild(body);

  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;

  messageMap.set(id, { setButtons, get reactions(){ return reactions; }, set reactions(v){ reactions=v; setButtons(); } });
}

socket.on('message', (data)=>{
  const self = (data && data.user && (data.user === (nickname.value.trim()||'Anonymous')));
  renderMessage(data, self);
  if(!self) notify(`${data.user}`, data.text);
});

socket.on('reaction', ({messageId, reactions})=>{
  const m = messageMap.get(messageId);
  if(m){ m.reactions = reactions; }
});

socket.on('users', (list)=>{
  users.innerHTML='';
  list.forEach(u=>{
    const row = document.createElement('div');
    row.className = 'user';
    const img = document.createElement('img'); img.src=u.avatar; img.alt=u.name;
    const span = document.createElement('span'); span.textContent = u.name;
    row.appendChild(img); row.appendChild(span);
    users.appendChild(row);
  });
  statusEl.textContent = `${list.length} online`;
});

socket.on('system', addSystem);

socket.on('typing', ({user, status})=>{
  typingEl.textContent = status ? `${user} is typing…` : '';
});

// Defaults
nickname.value = localStorage.getItem('nick') || '';
room.value = localStorage.getItem('room') || 'general';
joinBtn.addEventListener('click', ()=>{
  localStorage.setItem('nick', nickname.value.trim() || 'Anonymous');
  localStorage.setItem('room', room.value.trim() || 'general');
});
