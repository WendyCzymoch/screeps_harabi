class Ticket {
  constructor(type) {
    this.win = 0
    this.lose = 0
    this.type = type
    if (type === 'mercy') {
      this.mercy = 2
    } else if (type === 'ferocity') {
      this.ferocityOn = false
    }
  }

  isComplete() {
    return this.win >= 7 && this.lose === 0
  }

  isBroken() {
    if (this.type === 'ferocity') {
      return this.lose > 0
    } else if (this.type === 'mercy') {
      if (this.win < 3 && this.mercy < 2) {
        return true
      }
      if (this.win < 4 && this.mercy < 1) {
        return true
      }
      return this.lose > 0
    }
  }

  recordWin() {
    this.win++
    if (this.type === 'ferocity' && !this.ferocityOn && this.win >= 3 && this.lose === 0) {
      this.ferocityOn = true
    }
  }

  recordLose() {
    if (this.mercy > 0) {
      this.mercy--
      console.log(`MERCY: mercy left:${this.mercy}`)
      return
    }
    this.lose++
    return
  }

  reset() {
    this.win = 0
    this.lose = 0
    if (this.type === 'mercy') {
      this.mercy = 2
    } else if (this.type === 'ferocity' && this.ferocityOn) {
      this.win = 3
      return
    }
    console.log(`RESET: reset ticket`)
    return
  }
}

function runTrials(ticket, probability) {
  if (Math.random() < probability) {
    ticket.recordWin()
    console.log(`WIN: win:${ticket.win}, lose:${ticket.lose}`)
    return
  }
  ticket.recordLose()
  console.log(`LOSE: win:${ticket.win}, lose:${ticket.lose}`)
}

function goToLightHouse(type, probability) {
  const ticket = new Ticket(type)
  let numGame = 0
  while (!ticket.isComplete()) {
    runTrials(ticket, probability)
    numGame++
    if (ticket.isBroken()) {
      ticket.reset()
    }
  }

  console.log(`Played ${numGame} games to go lighthouse`)
  return numGame
}

function getAvrageNumGame(type, probability, number) {
  let numGame = 0
  let numLightHouse = 0
  while (numLightHouse < number) {
    numGame += goToLightHouse(type, probability)
    numLightHouse++
  }

  const result = numGame / numLightHouse

  console.log(`Played about ${result.toFixed(2)} games to go lighthouse for ${number} of times`)
  return result
}

let result = {}

const probabilities = [0.6, 0.61, 0.62]

for (const probability of probabilities) {
  result[probability] = {
    mercy: getAvrageNumGame('mercy', probability, 100),
    ferocity: getAvrageNumGame('ferocity', probability, 100),
  }
}

console.log('-------------------------------------------------------------------')
for (const probability in result) {
  console.log(
    `승률: ${probability}     자비:${result[probability].mercy.toFixed(2)}     흉포:${result[probability].ferocity.toFixed(2)}`
  )
}
