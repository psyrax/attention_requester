var five = require("johnny-five"),
  irc = require('irc'),
  sleep = require('sleep'),
  express = require('express'),
  exphbs  = require('express3-handlebars'),
  app = express(),
  server = require('http').createServer(app),
  io = require('socket.io').listen(server),
  twitter = require('twitter'),
  twitterAPI = require('node-twitter-api'),
  board, lcd, light, shutLight, socketSend, socketEnable;

//App configuration
var config = require('./config.json');

//Express port
server.listen(1337);

//Logging uncaught exceptions
process.on('uncaughtException', function(err) {
  console.log(err);
});


//Express app config
app.configure(function() {
  app.use(express.static(__dirname + '/public'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.engine('handlebars', exphbs({defaultLayout: 'main'}));
  app.set('view engine', 'handlebars');
});

//Twitter api configuraiton
var twitterapi = new twitterAPI({
  consumerKey: config.Twitter.apiKey,
  consumerSecret: config.Twitter.apiSecret,
  callback: config.Twitter.appCallback
});


//Fancy printing. It prints in the whole LCD
shutLight;
function fancyPrinter(message, callback){
  lcd.clear().home();
  sleep.sleep(1);
  var rowCounter = 0;
  var colCounter = 0;
  clearTimeout(shutLight);
  light.fadeIn(500);
  shutLight = setTimeout( function() {
    //light.fadeOut(2000);
  }, 5000);
  for (var i = 0; i < message.length; i++) {
    if(i === 16){
      rowCounter = 1;
      colCounter = 0;
    } else if ( i === 32 ){
      callback(true);
      break;
    };
    lcd.cursor(rowCounter, colCounter).print(message.charAt(i));
    colCounter++;
  };
  callback(true);
};

//BOARD TIME
board = new five.Board();

//connecting to board
board.on('ready', function() {

  //LCD pin out
  lcd = new five.LCD({
    // LCD pin name  RS  EN  DB4 DB5 DB6 DB7
    // Arduino pin # 12  11   5   4  3  2
    pins: [12,11,5,4,3,2],
    rows: 2,
    cols: 16
  });

  //LCD Backlight pin
  light = new five.Led(9);

  //LCD is ready, beacause LCD is slow.
  lcd.on('ready', function() {
    fancyPrinter('LCD Ready', function(){});
    //Wait 1 seconds before IRC for the lolz
    sleep.sleep(1);
    clients.irc();
    //wait 1 seconds before setting express app
    sleep.sleep(1);
    fancyPrinter('Express ready', function(){
      clients.expressInit();
    });
  });

});

var clients = {
  irc : function(){
    /* IRC CLIENT */

    //config
    var irc = require('irc');
    var ircClient = new irc.Client(config.IRC.server, config.IRC.username, {
        channels: config.IRC.channels
    });
    //Identify the bot
    ircClient.addListener('registered', function(){
      fancyPrinter('REGISTER...', function(){
        ircClient.say('NickServ', 'REGISTER ' + config.IRC.identifyPass + ' ' + config.IRC.email);
      });
      fancyPrinter('IDENTIFY', function(){
        ircClient.say('NickServ', 'IDENTIFY ' + config.IRC.identifyPass );
      });
    });
    ircClient.addListener('notice', function (nick, to, text, message){
      if( nick == 'NickServ'){
        fancyPrinter(nick + '-' + text, function(){});
      };
    });

    //Say hello at entrance
    ircClient.addListener('names', function (chan, nick, message){
      fancyPrinter('Joined ' + chan, function(){
        ircClient.notice(chan, 'Hola soy un robot.');
        ircClient.say(chan, '!op')
      });
    });

    //Say hello to new user
    ircClient.addListener('join', function (chan, nick, message){
      if( nick != config.IRC.username )
      ircClient.notice(chan,'Hola ' + nick + ' :D');
    });

    //Read notifications
    ircClient.addListener('message', function (from, to, message) {
      if(message.indexOf(config.IRC.notifyFor) > -1) {    
        var fullMessage = from + ':' + message;
        fancyPrinter(fullMessage, function (end){});
      }
    });

    //Read PM
    ircClient.addListener('pm', function (nick, text, message){
      fancyPrinter( nick + ':' + text, function(){
        ircClient.say(nick, 'igualmente');
      });
    });
  },
  twitterStream : function(){
    //Configuración de twitter.
    var twit = new twitter({
        consumer_key: config.Twitter.apiKey,
        consumer_secret: config.Twitter.apiSecret,
        access_token_key: config.Twitter.accessToken,
        access_token_secret: config.Twitter.accessTokenSecret
    });

    //lectura del stream de twitter
    twit.stream('user', {track: config.Twitter.username, with: 'user'}, function(stream) {
      stream.on('data', function(data) {
        if( data.text != undefined  && data.user.screen_name != undefined){
          var tuitText = '@' + data.user.screen_name + ':' + data.text;
          fancyPrinter(tuitText, function(){});
          clients.socketEmitter('twitter', data);
        } else if ( data.direct_message != undefined ){
          var tuitText = data.direct_message.text;
          fancyPrinter(tuitText, function(){});
          if ( tuitText.indexOf("Reddit check") != -1 ) {
            clients.socketEmitter('reddit', data);
          };
        };
      });
    });
  },
  expressInit : function(){
    //Send index file on root
    app.get('/', function (req, res) {
      res.render('index');
    });
    //Turn leds off
    app.get('/notifications/read', function (req, res) {
      light.fadeOut(2000);
      res.send('ok');
    });
    //Twitter login
    app.get('/login', function (req, res){
      twitterapi.getRequestToken(function(error, requestToken, requestTokenSecret, results){
        if (error) {
          console.log("Error getting OAuth request token : " + error);
        } else {
          config.Twitter.requestToken = requestToken;
          config.Twitter.requestTokenSecret = requestTokenSecret;
          res.redirect('https://twitter.com/oauth/authenticate?oauth_token=' + requestToken);
        }
      });
    });
    //Twitter callback
    app.get('/callback', function (req, res){
      twitterapi.getAccessToken(config.Twitter.requestToken, config.Twitter.requestTokenSecret, req.query.oauth_verifier, function(error, accessToken, accessTokenSecret, results) {
        if (error) {
          console.log(error);
        } else {
          config.Twitter.accessToken = accessToken;
          config.Twitter.accessTokenSecret = accessTokenSecret;
          twitterapi.verifyCredentials(accessToken, accessTokenSecret, function(error, data, response) {
            config.Twitter.username = data["screen_name"];
            clients.twitterStream();
            fancyPrinter('Twitter connected', function(){
              res.redirect('/');
            })
          });
        }
      });
    });
  },
  socketEmitter : function (type, data){
    app.render(type, {layout: false, 'data': data, helpers: {
      urlMaker: function (string) {
        var exp = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        string = string.replace(exp, "<a href='$1' target='_blank'>$1</a>");
        return string;
      }
    }},function (err, html){
      io.sockets.emit('update', {'content': html});
    });
  }
}

io.sockets.on('connection', function (socket) {
  socketEnable = true;
});