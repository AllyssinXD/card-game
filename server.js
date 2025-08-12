const ws = require("ws")
const http = require("http")
const uuidv4 = require("uuid").v4
const url = require("url")

const port = 8000
const server = http.createServer()
const wsServer = new ws.WebSocketServer({ server })

const connections = {}
let users = []

let gameState = "WAITING_PLAYERS"
let turn = null
let lastCard = null

const colors = ["BLUE", "RED", "GREEN", "YELLOW"]

class Card {
    constructor(color, num){
        this.color = color
        this.num = num
        this.id = uuidv4()
    }

    static random(){
        return new Card(colors[Math.floor(Math.random() * colors.length)],
         Math.floor(Math.random() * 9) + 1 + "") 
    }

    static distributeCards(){
        let cards = []
        for(let i = 0; i<7;i++){
                cards.push(Card.random())
        }
        return cards
    }

    static compatible(card1, card2) {
        return card1.color == card2.color || card1.num == card2.num
    }

    getString(){
        return color + "_" + num
    }
}

const broadcastGameStatus = ()=>{
    users.forEach(user=>{
        const id = user.id
        const playerState = user.state
        const otherUsersInfo = users.map(user=>{
            if(user.id != id) return {id: user.id, isTyping: false, username: user.username, cardsLength: user.state.cards.length}
        })
        connections[id].send(JSON.stringify({lastCard, players: otherUsersInfo, gameState, turn, state: playerState}))
    })
}

const nextTurn = () => {
    turn = users[users.indexOf(users.find(u=>u.id==turn)) + 1] ? users[users.indexOf(users.find(u=>u.id==turn)) + 1].id : users[0].id
}

const sendCard = (card, user)=>{
    lastCard = card
    user.state.cards = user.state.cards.filter(c=>c.id!=card.id)
    nextTurn()
    users = users.map(u=>u.id==user.id?user:u)
    connections[user.id].send("Carta jogada com sucesso!")
    broadcastGameStatus()
}

const buyCard = (user) => {
    const newCard = Card.random()
    user.state.cards.push(newCard)
    users = users.map(u=>u.id==user.id?user:u)
    connections[user.id].send("Carta comprada com sucesso")
    broadcastGameStatus()
    return newCard
}

const startGame = ()=>{
    console.log("Começando o jogo!")
    gameState = "GOING"
    turn = users[0].id
    lastCard = Card.random()
    const newUsers = users.map(user=>{
        user.state.cards = Card.distributeCards()
        return user
    })
    users = newUsers

    broadcastGameStatus()
}

wsServer.on("connection", (connection,request)=>{
    const {username} = url.parse(request.url, true).query
    if(!username) {
        connection.close(1013, "Nome vázio")
        return
    }
    if(gameState != "WAITING_PLAYERS") { 
        connection.close(1013, "Jogo já começou")
        return
    }

    const id = uuidv4()
    connections[id] = connection
    console.log("Um Jogador Entrou! ", username)

    users.forEach(user=>{
        const id = user.id
        connections[id].send("Um novo jogador entrou no jogo! " + username)
    })
    users.push({
        id,
        username,
        state: {
            cards: []
        }
    })

    connection.send(JSON.stringify({yourId: id}))

    connection.on("close", ()=>{

        console.log("Um Jogador Saiu ... " + users.find(user=>user.id==id).username)
        delete connections[id]
        users = users.filter(user=>user.id!=id)

        if(gameState == "GOING" && users.length < 3) gameState = "WAITING PLAYERS"

        console.log(users)
    })

    connection.on("message", message => {
        try{
            const {action} = JSON.parse(message)
            const user = users.find(user=>user.id==id)

            if(gameState == "WAITING_PLAYERS"){
                if(action == "START_GAME" && id == users[0].id){
                    startGame()
                }
            }

            if(gameState == "GOING") { 
                if(action.startsWith("PLAY_")){
                    if(turn != id) {
                        connection.send(JSON.stringify({error: "not your turn"}))
                        return
                    }
                    const cardId = action.replace("PLAY_", "")
                    if(!cardId) {
                        connection.send(JSON.stringify({error: "Id da carta não foi passado"}))
                        return
                    }
                    const card = user.state.cards.find(card=>card.id==cardId)
                    if(!card) {
                        connection.send(JSON.stringify({error: "Carta não encontrada"}))
                        return
                    }
                    if(Card.compatible(card, lastCard)) {
                        sendCard(card, user)
                        return
                    }
                    connection.send(JSON.stringify({error: "cant send this card"}))
                }

                if(action.startsWith("BUY")){
                    if(turn != id) {
                        connection.send(JSON.stringify({error: "not your turn"}))
                        return
                    }
                    const newCard = buyCard(user)
                    connection.send(JSON.stringify({newCard}))
                    let canPlay = false
                    user.state.cards.forEach(card=>{
                        if(Card.compatible(card, lastCard)){
                            canPlay = true
                        }
                    })
                    if(!canPlay){
                        nextTurn()
                    }
                }
                if(user.state.cards.length == 0){
                    connection.send(JSON.stringify({message: "O jogador " + user.username + " venceu!"}))
                    gameState = "WAITING_PLAYERS"
                    lastCard = null
                    let turn = null

                    connections.forEach(con=>{
                        con.close();
                    })
                }
            }
        } catch (err) {
            console.log(err)
        }
    })
})

server.listen(port, ()=>{
    console.log(`Servidor HTTP funcionando na porta ${port}`)
})