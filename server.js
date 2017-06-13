/**
 *  Created by Orion Wolf_Hubbard on 6/4/2017.
 */

let app = require('express')();
let http = require('http').Server(app);
let io = require('socket.io')(http);
let port = process.env.PORT || 3000;

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html') });
http.listen(port,() => { console.log('listening on *:' + port) });

let userMap = {};
let lobby = {};
let passwordMap = {};
let tables = {};
let games = {};

let newTable = function () {
    this.player1 = null;
    this.player2 = null;
    this.player3 = null;
    this.player4 = null;
};

let newPlayer = function (name, userId) {
    this.name = name;
    this.userId = userId;
    this.ready = 'not ready';
    this.cards = null;
};

let newUser = function (userId) {
    this.name = 'no input';
    this.tableId = 'none';
    this.userId = userId;
};

io.on('connection', socket => {
    let userId = socket.id;
    
    io.to(userId).emit('setup_login');
    userMap[userId] = new newUser(userId);
    let user = userMap[userId];
    socket.on('login', loginInfo => {
        let NAME = 0, PASS = 1;
        if (loginInfo[NAME] in passwordMap) {
            if (passwordMap[loginInfo[NAME]] === loginInfo[PASS]) {
                userMap[userId].name = loginInfo[NAME];
            } else {
                //resend 'login_setup' on fail TODO make this better...
                io.to(userId).emit('login_setup');
            }
        } else {
            //if username doesn't already exist add it and login
            console.log(`${loginInfo[NAME]} logging in`);
            passwordMap[loginInfo[NAME]] = loginInfo[PASS];
            userMap[userId].name = loginInfo[NAME];
        }
        //if the user's name has been changed, they are logged in, emit 'lobby_setup'
        if (userMap[userId].name !== 'no input') {
            lobby[userId] = userMap[userId].name;
            for (let key in lobby) io.to(key).emit('lobby', tables );
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`user ${userMap[userId].name} logging off`);
        //if the user has joined a table, remove them
        if(user.tableId !== 'none'){
            if (user.tableId in tables) {
                let player;
                let table = tables[user.tableId];
                for (let key in table)
                    if (table[key] !== null)
                        if (table[key].userId === userId)
                            player = key;
                table[player] = null;
                //check if anyone is still at the table, update table if so, delete table if not
                let empty = true;
                for (let key in table) if (table[key] !== null) empty = false;
                if (empty) {
                    delete tables[user.tableId];
                } else {
                    for (let key in table)
                        if (table[key] !== null)
                            io.to(table[key].userId).emit('table', [table, key]);
                }
                for (let key in lobby) io.to(key).emit('lobby', tables );
            }
        }
        delete userMap[userId];
    });
    
    socket.on('join_table', tableId => {
        //new table
        if (tableId === 'new') {
            //make new table, add player to it
            tableId = Math.random().toString(36).substr(2, 5);
            tables[tableId] = new newTable();
            let table = tables[tableId];
            user.tableId = tableId;
            table.player1 = new newPlayer(user.name, userId);
            //remove user from lobby and update lobby
            delete lobby[userId];
            for (let key in lobby) io.to(key).emit('lobby', tables );
            //emit table to players in table
            for (let key in table)
                if (table[key] !== null)
                    io.to(table[key].userId).emit('table', [table, table[key].userId]);
        
        } else {
            //join existing table
            let table = tables[tableId];
            let added = false;
        
            for (let i = 1; i < 5; i++) {
                let seat = 'player' + i;
                //if that player is null
                if (table[seat] === null) {
                    //add the player
                    user.tableId = tableId;
                    table[seat] = new newPlayer(user.name, userId);
                    //flip the boolean
                    added = true;
                    delete lobby[userId];
                    //exit the loop
                    i = 420;
                }
            }
            //if the user was added
            if (added) {
                // update table for table recipients
                for (let key in table)
                    if (table[key] !== null)
                        io.to(table[key].userId).emit('table', [table, key]);
                //remove from lobby and update lobby for lobby recipients
                delete lobby[userId];
                for (let key in lobby) io.to(key).emit('lobby', tables );
            }
        }
    });
    
    //when player hits ready button at table
    socket.on('ready', player => {
        let table = tables[user.tableId];
        //flip player's ready property
        if (table[player].ready === 'not ready')
            table[player].ready = 'ready';
        else table[player].ready = 'not ready';
        //update clients in table
        for (let p in table)
            if (table[p] !== null)
                io.to(table[p].userId).emit('table', [table, p]);
        //check if all players are ready
        let ready = 0;
        for (let p in table)
            if (table[p] !== null)
                if (table[p].ready === 'ready')
                    ready++;
        if (ready === 4) newGame(user.tableId);
    });
    
    socket.on('play_card', () => {
        let game = games[user.tableId];
        let player = user.playerNumber;
        let card = game[player].cards[0];
        //if someone played a face/ace
        if (game.facePlayer !== 'none') {
            //if player plays a face/ace
            if (card[0] > 10 || card[0] === 1) {
                //change facePlayer and set triesLeft
                game.facePlayer = player;
                if (card[0] === 1) game.triesLeft = 4;
                else if (card[0] === 13) game.triesLeft = 1;
                else if (card[0] === 14) game.triesLeft = 2;
                else if (card[0] === 15) game.triesLeft = 3;
                //add the card to game pile
                game.pile.push(card);
                //remove the card from player cards
                game[user.playerNumber].cards.splice(0,1);
                //next player's turn
                nextPlayer(user.tableId);
                //update
                for (let i = 1; i < 5; i++) {
                    let p = 'player' + i;
                    io.to(game[p].userId).emit('game_info', game);
                }
            } else if (game.triesLeft === 1 || game[player].cards.length === 1) {
                //no-ones turn, wait for player to claim pile or slap
                game[player].ready = false;
                game.roundOver = true;
                //add the card to game pile
                game.pile.push(card);
                //remove the card from player cards
                game[player].cards.splice(0,1);
                //update game
                for (let i = 1; i < 5; i++) {
                    let p = 'player' + i;
                    io.to(game[p].userId).emit('game_info', game);
                }
                
            } else { //player goes again
                game.triesLeft--;
                //add the card to game pile
                game.pile.push(card);
                //remove the card from player cards
                game[user.playerNumber].cards.splice(0,1);
                //update game
                for (let i = 1; i < 5; i++) {
                    let p = 'player' + i;
                    io.to(game[p].userId).emit('game_info', game);
                }
            }
        } else {
            //if player plays a face/ace
            if (card[0] > 10 || card[0] === 1) {
                //change facePlayer and set triesLeft
                game.facePlayer = player;
                if (card[0] === 1) game.triesLeft = 4;
                else if (card[0] === 13) game.triesLeft = 1;
                else if (card[0] === 14) game.triesLeft = 2;
                else if (card[0] === 15) game.triesLeft = 3;
                //add the card to game pile
                game.pile.push(card);
                //remove the card from player cards
                game[user.playerNumber].cards.splice(0,1);
                //next player's turn
                nextPlayer(user.tableId);
                //update
                for (let i = 1; i < 5; i++) {
                    let p = 'player' + i;
                    io.to(game[p].userId).emit('game_info', game);
                }
                //if player is out of cards or tries
            } else {
                game.pile.push(card);
                //remove the card from player cards
                game[user.playerNumber].cards.splice(0, 1);
                //change turns
                nextPlayer(user.tableId);
                //emit game to players
                for (let i = 1; i < 5; i++) {
                    let p = 'player' + i;
                    io.to(game[p].userId).emit('game_info', game);
                }
            }
        }
    });
    
    //emit from client when it is their turn and they have no cards
    socket.on('no_cards', () => {
        let game = games[user.tableId];
        nextPlayer(user.tableId);
        for (let i = 1; i < 5; i++) {
            let p = 'player' + i;
            io.to(game[p].userId).emit('game_info', game);
        }
    });
    
    socket.on('slap', () => {
        let game = games[user.tableId];
        let player = user.playerNumber;
        let cards = game.pile;
        console.log(user.name + ' slapped the pile');
        console.log(cards);
        let isSlapped = false;
        
        //check slap conditions here: todo: add more
        
        
        
        if (cards.length > 3){
            if (cards[0][0] === cards[cards.length - 1][0]) isSlapped = true;
            let l = cards.length;
            if (isRun(cards[l-1][0], cards[l-2][0], cards[l-3][0], cards[l-4][0])) isSlapped = true;
        }
        
        if (cards.length > 1) {
            if (cards[cards.length - 1][0] === cards[cards.length - 2][0]) isSlapped = true;
            if (cards[cards.length - 1][0] + cards[cards.length - 2][0] === 10) isSlapped = true;
        }
        if (cards.length > 2) {
            if (cards[cards.length - 1][0] === cards[cards.length - 3][0]) isSlapped = true;
            if (cards[cards.length - 1][0] + cards[cards.length - 3][0] === 10) isSlapped = true;
        }
        
        //if the player has won the round
        if (game.roundOver && player === game.facePlayer) {
            for (let i = 1; i < 5; i++) {
                let p = 'player' + i;
                io.to(game[p].userId).emit('slap', `<h2>${user.name}<br>won the pile!</h2>`);
            }
            takePile(user.tableId, player);
        } else {
            
            //legit slap
            if(isSlapped){
                for (let i = 1; i < 5; i++) {
                    let p = 'player' + i;
                    io.to(game[p].userId).emit('slap', `<h2>${user.name}<br>slapped and took<br>the pile!</h2>`);
                }
                takePile(user.tableId, player);
            } else {
                //illegitimate slap
                if (game[player].cards.length !== 0) {
                    let c = game[player].cards[0];
                    console.log(`${c[0]} of ${c[1]} bottom piled`);
                    //take their top card and put it at the bottom of the deck
                    game.pile.splice(0, 0, game[player].cards.splice(0, 1)[0]);
                    //if the user is out of cards. next player
                    if (game[player].cards.length === 0)
                        nextPlayer(user.tableId);
                    for (let i = 1; i < 5; i++) {
                        let p = 'player' + i;
                        io.to(game[p].userId).emit('slap', `
<h2>${user.name}<br>slapped and added <br>${printCard(c)}<br> to bottom</h2>`);
                    }
                }///TODO else emit 'time_out' to player here
            }
        }
    });
    
});

//for displaying card on miss-slaps
const printCard = (card) =>
    `<img src= "http://owolfhu1.x10host.com/Oh_Hell_solo/img/card${card[1]}${card[0]}.png" style="height: 35%;">`;

const takePile = (tableId, player) => {
    let game = games[tableId];
    console.log(game.pile);
    //push all pile cards to player cards
    for (let i = 0; i < game.pile.length; i++) {
        console.log(`pushing ${game.pile[i]} to ${game[player].name}`);
        game[player].cards.push(game.pile[i]);
    }
    //empty the pile
    game.pile = [];
    //turn everyone off
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        game[p].ready = false;
    }
    //give turn to player who won
    game[player].ready = true;
    game.roundOver = false;
    game.facePlayer = 'none';
    game.triesLeft = 0;
    //clear pile and send game_info
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        io.to(game[p].userId).emit('clear_game');
        io.to(game[p].userId).emit('game_info', game);
    }
};

const newGame = tableId =>  {
    //move the table from tables to games
    games[tableId] = tables[tableId];
    let game = games[tableId];
    delete tables[tableId];
    //update lobby
    for (let player in lobby)
        io.to(player).emit('lobby', tables);
    //setup game for clients
    for (let player in game) {
        game[player].ready = false;
        game[player].cards = [];
        io.to(game[player].userId).emit('setup_game');
    }
    //make a deck
    let gameDeck = deck();
    //deal it out
    for (let player in game)
        for (let i = 0; i < 13; i++) {
            game[player].cards.push(gameDeck[0]);
            gameDeck.splice(0,1);
        }
    //add playerNumber property to users
    for (let player in game){
        userMap[game[player].userId].playerNumber = player;
    }
    //add properties to game
    game.pile = [];
    game.facePlayer = 'none';
    game.triesLeft = 0;
    game.roundOver = false;
    //give a random player the first turn
    let turn = 'player' + (Math.floor(Math.random() * 4) + 1);
    game[turn].ready = true;
    //start game
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        io.to(game[p].userId).emit('game_info', game);
    }
};

const deck = () => {
    let deckReturn = [];
    const deckValues = [
        [1,2,3,4,5,6,7,8,9,10,13,14,15],
        ["clubs", "spades", "hearts", "diamonds"]
    ];
    for (let v = 0; v < deckValues[0].length; v++)
        for (let s = 0; s < deckValues[1].length; s++) {
            deckReturn.push([deckValues[0][v], deckValues[1][s]]);
        }
    shuffle(deckReturn);
    return deckReturn;
};
const shuffle = array => {
    for (let i = array.length; i; i--) {
        let j = Math.floor(Math.random() * i);
        [array[i - 1], array[j]] = [array[j], array[i - 1]];
    }
};

const nextPlayer = tableId => {
    let game = games[tableId];
    let next;
    if (game.player1.ready) {
        game.player1.ready = false;
        game.player2.ready = true;
        next = 'player2';
    } else if (game.player2.ready) {
        game.player2.ready = false;
        game.player3.ready = true;
        next = 'player3';
    } else if (game.player3.ready) {
        game.player3.ready = false;
        game.player4.ready = true;
        next = 'player4';
    } else if (game.player4.ready) {
        game.player4.ready = false;
        game.player1.ready = true;
        next = 'player1';
    }
    //if the player who's turn got turned on has no cards, next player again
    if (game[next].cards.length === 0) nextPlayer(tableId);
};

const isRun = (a,b,c,d) => {
    let bool = false;
    a = map(a); b = map(b); c = map(c); d = map(d);
    if (a === b+1 && b === c+1 && c === d+1) bool = true;
    if (d === c+1 && c === b+1 && b === a+1) bool = true;
    return bool;
};

const map = a => {
    if (a === 13) a = 11;
    if (a === 14) a = 12;
    if (a === 15) a = 13;
    return a;
};

/*TODO:
        -add DB
        -add sound
        -make game for 2-4 players rather than just 4 players
        -add end to game
*/

