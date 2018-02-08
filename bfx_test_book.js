/*
  2018.02.08

  Bitfinex에서 OrderBook을 만들 때 사용하라고 준 예제를 분석해봄
*/

//node.js에서 websocket을 빠르게 테스트 해볼 수 있는 라이브러리
const WS = require('ws') 

 // javascript utility library
 // 크로스 환경에 더 안정성을 주고자 만들어짐 -> 무슨 말인지 모르겠음.
 // Node.js를 사용하는 유저라면 lodash를 사용하는게 좋다고 함
const _ = require('lodash')

const async = require('async') // javascript async libaray
const fs = require('fs') // node's file system
const moment = require('moment') // javascript date library

// 이건 뭐냐면 terminal에서 입력하는 세번째 명령어(?)
// 그니까 node bfx_test_book.js tBTCUSD 라고 명령어를 치면 process.argv[2]는 tBTCUSD 임
const pair = process.argv[2]

// 웹소켓 config
const conf = {
  wshost: "wss://api.bitfinex.com/ws/2"
}

const logfile = __dirname + '/logs/ws-book-err.log'

//오더북 데이터를 넣을 변수
const BOOK = {}

console.log(pair, conf.wshost)

let connected = false
let connecting = false
let cli

// 2. 웹소켓 연결
function connect() {

  if (connecting || connected) return
  connecting = true

  // bitfinex 웹소켓 주소로 웹소켓 객체 만듬
  cli = new WS(conf.wshost, { /*rejectUnauthorized: false*/ })
  
  // 웹소켓 들어가자
  cli.on('open', function open() {
    console.log('WS open')
    connecting = false
    connected = true
    BOOK.bids = {}
    BOOK.asks = {}
    BOOK.psnap = {}
    BOOK.mcnt = 0

    // 3. 연결됐으면, 웹소켓으로 오더북 불러오쟈
    cli.send(JSON.stringify({ event: "subscribe", channel: "book", pair: pair, prec: "P0" }))
  })

  cli.on('close', function open() {
    console.log('WS close')
    connecting = false
    connected = false
  })

  // 4. 웹소켓으로 메세지 받아서 가공하는 곳
  cli.on('message', function(msg) {
    // string to json ( 서버로 받는 데이터는 항상 스트링 )
    msg = JSON.parse(msg)

    if (msg.event) return
    if (msg[1] === 'hb') return //빈값

    //msg[1] : data
    
    // 5.mcnt으로 가장 첨에 들어왔을때만 전체 값을 정제해서 Book에 값을 넣어줌
    if (BOOK.mcnt === 0) {
      
      // lodash를 이용한 forEash 구문 (기존 loop보다 성능이 좋다함)
      _.each(msg[1], function(pp) {
        // 배열을 변수 넣어서 원하는 모양으로 만들어줌
        pp = { price: pp[0], cnt: pp[1], amount: pp[2] }
        const side = pp.amount >= 0 ? 'bids' : 'asks' //amount로 side를 구분
        pp.amount = Math.abs(pp.amount) //절대값으로 리턴
        BOOK[side][pp.price] = pp //price를 key값으로 저장함
      })

      // console.log("FIRST ",BOOK)
      // 초기 오더북 완성
    } else {

      // 두번째 부턴 이제 기존 값 업데이트 해주는 단계~
      let pp = { price: msg[1], cnt: msg[2], amount: msg[3], ix: msg[4] }
      if (!pp.cnt) {
        let found = true
        if (pp.amount > 0) {
          if (BOOK['bids'][pp.price]) {
            delete BOOK['bids'][pp.price]
          } else {
            found = false
          }
        } else if (pp.amount < 0) {
          if (BOOK['asks'][pp.price]) {
            delete BOOK['asks'][pp.price]
          } else {
            found = false
          }
        }
        if (!found) {
          fs.appendFileSync(logfile, "[" + moment().format() + "] " + pair + " | " + JSON.stringify(pp) + " BOOK delete fail side not found\n")
        }
      } else {
        let side = pp.amount >= 0 ? 'bids' : 'asks'
        pp.amount = Math.abs(pp.amount)
        BOOK[side][pp.price] = pp
      }
    }

    // 6. 오더북 가격을 업데이트 해주는 과정인거 같음 (아직 완벽하게 이해 못함)
    // book안에 psnap 변수에다가 실시간으로 오더북 가격 업데이트를 해줌
    _.each(['bids', 'asks'], function(side) { 
      //side 변수에는 bids와 asks가 들어감

      let sbook = BOOK[side] // bids나 asks 데이터들
      let bprices = Object.keys(sbook) // 데이터의 키값 집합. 여기서 키 값은 price로 되어있음

      let prices = bprices.sort(function(a, b) {

        if (side === 'bids') {
          return +a >= +b ? -1 : 1
        } else {
          return +a <= +b ? -1 : 1
        }
      })

      BOOK.psnap[side] = prices

      // console.log("num price points", side, prices.length)
    })

    // 7. mcnt 카운트를 더해주고
    BOOK.mcnt++
    checkCross(msg)
  })
}

// 1. 연결된 상태이면 return, 연결되지 않았으면 connect()
setInterval(function() {
  if (connected) return
  connect()
}, 2500)

// 8. 다시 한번 체크 해주는듯?
function checkCross(msg) {
  let bid = BOOK.psnap.bids[0]
  let ask = BOOK.psnap.asks[0]

  // 파는게 사는값보다 크는 상황(오류 상황?)일 경우, file에 오류 보고
  if (bid >= ask) {
    let lm = [moment.utc().format(), "bid(" + bid + ")>=ask(" + ask + ")"]
    fs.appendFileSync(logfile, lm.join('/') + "\n")
  }
}

// 10. 오더북 저장
function saveBook() {
  const now = moment.utc().format('YYYYMMDDHHmmss')
  fs.writeFileSync(__dirname + "/logs/tmp-ws-book-" + pair + '-' + now + '.log', JSON.stringify({ bids: BOOK.bids, asks: BOOK.asks}))

  //'tmp-ws-book-tBTCUSD-20180208041426.log'이런 파일에 오더북 데이터가 저장됌.
}

// 계속 메세지를 받고 가공하고 checkCross 해주다가
// 9. 300000 millionsecond -> 5 minutes 후에 book을 저장한다.
setInterval(function() {
  saveBook()
}, 300000) 
