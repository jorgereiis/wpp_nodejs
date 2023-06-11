const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fileUpload = require('express-fileupload');
const port = process.env.PORT || 8001;
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const fs = require('fs');
const dirQrCode = './qrcode'
const path = require('path');
const cors = require('cors');
app.use(cors());

if (!fs.existsSync(dirQrCode)){
  fs.mkdirSync(dirQrCode)
}

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

app.use(fileUpload({
  debug: false
}));

app.get('/', (req, res) => {
  res.sendFile('index-multiplas-contas.html', {
    root: __dirname
  });
});

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

// Função para verificar e atualizar o conteúdo do arquivo
function checkAndUpdateSessionsFile() {
  fs.readFile(SESSIONS_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('Erro ao ler o arquivo de sessões:', err);
      return;
    }

    // Verificar se o arquivo está vazio
    if (data.trim().length === 0) {
      console.log('Arquivo de sessões vazio. Inserindo [] no conteúdo.');

      // Atualizar o conteúdo do arquivo para '[ ]'
      fs.writeFile(SESSIONS_FILE, '[]', (err) => {
        if (err) {
          console.error('Erro ao atualizar o arquivo de sessões:', err);
        }
      });
    }
  });
}
// Verificar o arquivo a cada segundo
setInterval(checkAndUpdateSessionsFile, 1000);

const criarArquivoSessaoSeNaoExistir = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Arquivo criado com sucesso.');
    } catch(err) {
      console.log('Falha ao criar arquivo: ', err);
    }
  }
}
criarArquivoSessaoSeNaoExistir();

const setarArquivoSessao = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log(err);
    }
  });
}

const carregarArquivoSessao = function() {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const criarSessao = function(id, token) {
  console.log('Criando sessão: ' + id);
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      //executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    authStrategy: new LocalAuth({
      clientId: id
    })
  });

  client.initialize();

  if (!fs.existsSync(dirQrCode + '/' + id)){
    fs.mkdirSync(dirQrCode + '/' + id)
  }

  client.on('qr', async (qr) => {
    const currentDate = new Date();
    const formattedDate = `[${currentDate.toLocaleDateString()} ${currentDate.toLocaleTimeString()}]`;
    console.log(formattedDate, '- QRCode recebido', qr);
  
    const bufferImage = await qrcode.toDataURL(qr);
    var base64Data = bufferImage.replace(/^data:image\/png;base64,/, "");
    try {
      fs.unlinkSync(dirQrCode + '/' + id + '/qrcode.png');
    } catch(e){
    } finally {
      fs.writeFileSync(dirQrCode + '/' + id + '/qrcode.png', base64Data, 'base64');
    }
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QRCode recebido, aponte a câmera do seu celular!' });
    });
  });

  client.on('ready', async () => {
    io.emit('ready', { id: id });
    console.log('Disposito pronto: ' + id);
    io.emit('qr', './check.svg');
    io.emit('message', { id: id, text: 'Dispositivo pronto!' });
    try {
      fs.unlinkSync(dirQrCode + '/' + id + '/qrcode.png');
    } catch(e){
    }
    const savedSessions = carregarArquivoSessao();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setarArquivoSessao(savedSessions);

  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('qr', './check.svg');
    io.emit('message', { id: id, text: 'Dispositivo autenticado!' });
  });

  client.on('auth_failure', function() {
    io.emit('message', { id: id, text: 'Falha na autenticação, reiniciando...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'Dispositivo desconectado!' });
    client.destroy();
    client.initialize();

    const savedSessions = carregarArquivoSessao();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setarArquivoSessao(savedSessions);

    io.emit('remove-session', id);
  });

  sessions.push({
    id: id,
    token: token,
    client: client
  });

  const savedSessions = carregarArquivoSessao();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      token: token,
      ready: false,
    });
    setarArquivoSessao(savedSessions);
  }
}

const init = function(socket) {
  const savedSessions = carregarArquivoSessao();

  if (savedSessions.length > 0) {
    if (socket) {
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });

      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        criarSessao(sess.id, sess.token);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function(socket) {
  init(socket);

  socket.on('create-session', function(data) {
    console.log('Sessão criada: ' + data.id);
    criarSessao(data.id, data.token);
  });
});

// POST criar
app.post('/criar-sessao', [
    body('id').notEmpty(),
    body('token').notEmpty(),
  ], async (req, res) => {
    const errors = validationResult(req).formatWith(({
      msg
    }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped()
      });
    }

  const id = req.body.id;
  const token = req.body.token;
  
  try{
    criarSessao(id,token);
    res.status(200).json({
      status: true,
      message: 'Sessão criada: ' + id + ' - Token: ' + token
    })
  } catch(e){
    console.log(e)
    res.status(500).json({
      status: false,
      message: 'A sessão não pôde ser criada'
    })
  }  
});

// POST deletar
app.post('/deletar-sessao', [
  body('id').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

const id = req.body.id;
const token = req.body.token;
const client = sessions.find(sess => sess.id == id)?.client;
const savedSessions = carregarArquivoSessao();
const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
const tokenN = savedSessions.splice(sessionIndex, 1)[0].token;

if(tokenN !== token){
  res.status(422).json({
    status: false,
    message: 'Token inválido'
  })
  return;
}

try{
  client.destroy();
  client.initialize();
  const savedSessions = carregarArquivoSessao();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
  savedSessions.splice(sessionIndex, 1);
  setarArquivoSessao(savedSessions);
  fs.rmSync(dirQrCode + '/' + id, { recursive: true, force: true });
  res.status(200).json({
    status: true,
    message: 'Sessão deletada: ' + id
  })
} catch(e){
  res.status(500).json({
    status: false,
    message: 'A sessão não pôde ser deletada'
  })
}  
});

// POST status
app.post('/status-sessao', [
  body('id').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

const id = req.body.id;
const token = req.body.token;
const client = sessions.find(sess => sess.id == id)?.client;
const savedSessions = carregarArquivoSessao();
const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
const tokenN = savedSessions.splice(sessionIndex, 1)[0].token;

if(tokenN !== token){
  res.status(422).json({
    status: false,
    message: 'Token inexistente'
  })
  return;
}

try{
  const status = await client.getState();
  res.status(200).json({
    status: true,
    message: status
  })
} catch(e){
  res.status(500).json({
    status: false,
    message: 'Sessão inexistente'
  })
}  
});

// POST send-message
app.post('/send-message', [
  body('user').notEmpty(),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const sender = req.body.sender;
  const client = sessions.find(sess => sess.id == sender)?.client;
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `Sender: ${sender} não foi encontrado!`
    })
  }

  const token = req.body.token;
  const savedSessions = carregarArquivoSessao();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == sender);
  const tokenN = savedSessions.splice(sessionIndex, 1)[0].token;

  if(tokenN !== token){
    res.status(422).json({
      status: false,
      message: 'Token inválido'
    })
    return;
  }

  const user = req.body.user + '@c.us';
  const message = req.body.message;

    client.sendMessage(user, message).then(response => {
    res.status(200).json({
      status: true,
      message: 'Mensagem enviada',
      response: response
    });
    }).catch(err => {
    res.status(500).json({
      status: false,
      message: 'Mensagem não enviada',
      response: err.text
    });
    });
  
});

// POST send-media URL
app.post('/send-media', async (req, res) => {
  const sender = req.body.sender;
  const client = sessions.find(sess => sess.id == sender)?.client;
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `Sender: ${sender} não foi encontrado!`
    })
  }
  
  const token = req.body.token;
  const savedSessions = carregarArquivoSessao();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == sender);
  const tokenN = savedSessions.splice(sessionIndex, 1)[0].token;

  if(tokenN !== token){
    res.status(422).json({
      status: false,
      message: 'Token inválido'
    })
    return;
  }

  const user = req.body.user + '@c.us';
  const caption = req.body.caption;
  const fileUrl = req.body.file;
  const media = await MessageMedia.fromUrl(fileUrl);

    client.sendMessage(user, media, {caption: caption}).then(response => {
    res.status(200).json({
      status: true,
      message: 'Mensagem enviada',
      response: response
    });
    }).catch(err => {
    res.status(500).json({
      status: false,
      message: 'Mensagem não enviada',
      response: err.text
    });
    });
  
});

// POST send-media PATH
app.post('/send-media2', async (req, res) => {
  const sender = req.body.sender;
  const client = sessions.find(sess => sess.id == sender)?.client;
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `Sender: ${sender} não foi encontrado!`
    })
  }
  
  const token = req.body.token;
  const savedSessions = carregarArquivoSessao();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == sender);
  const tokenN = savedSessions.splice(sessionIndex, 1)[0].token;

  if(tokenN !== token){
    res.status(422).json({
      status: false,
      message: 'Token inválido'
    })
    return;
  }

  const user = req.body.user + '@c.us';
  const caption = req.body.caption;
  const filePath = req.body.file;
  const media = MessageMedia.fromFilePath(filePath);

    client.sendMessage(user, media, {caption: caption}).then(response => {
    res.status(200).json({
      status: true,
      message: 'Mensagem enviada',
      response: response
    });
    }).catch(err => {
    res.status(500).json({
      status: false,
      message: 'Mensagem não enviada',
      response: err.text
    });
    });
  
});

// POST send-media PATH
app.post('/send-media3', async (req, res) => {
  const sender = req.body.sender;
  const client = sessions.find(sess => sess.id == sender)?.client;
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `Sender: ${sender} não foi encontrado!`
    })
  }
  
  const token = req.body.token;
  const savedSessions = carregarArquivoSessao();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == sender);
  const tokenN = savedSessions.splice(sessionIndex, 1)[0].token;

  if(tokenN !== token){
    res.status(422).json({
      status: false,
      message: 'Token inválido'
    })
    return;
  }

  const user = req.body.user + '@c.us';
  const fileUrl = req.body.file;
  const media = await MessageMedia.fromUrl(fileUrl);

    client.sendMessage(user, media, {sendAudioAsVoice: true}).then(response => {
    res.status(200).json({
      status: true,
      message: 'Mensagem enviada',
      response: response
    });
    }).catch(err => {
    res.status(500).json({
      status: false,
      message: 'Mensagem não enviada',
      response: err.text
    });
    });
  
});

app.post('/image', function (req, res) {

  const sender = req.body.sender;
  const client = sessions.find(sess => sess.id == sender)?.client;
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `Sender: ${sender} não foi encontrado!`
    })
  }

  const token = req.body.token;
  const savedSessions = carregarArquivoSessao();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == sender);
  const tokenN = savedSessions.splice(sessionIndex, 1)[0].token;

  if(tokenN !== token){
    res.status(422).json({
      status: false,
      message: 'Token inválido'
    })
    return;
  }

  res.set({'Content-Type': 'image/png'});
  res.sendFile('./qrcode/' + sender + '/qrcode.png', {
    root: __dirname
  });
});

server.listen(port, function() {
  console.log('Aplicação rodando na porta *: ' + port);
});
