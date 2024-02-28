const { config } = require('./config')
const { HarassRequest } = require('./overlord_tasks_harass')

Memory.users = Memory.users || {}

Overlord.manageDiplomacy = function () {
  if (Math.random() < 0.99) {
    return
  }

  for (const username in Memory.users) {
    const userIntel = this.getUserIntel(username)
    if (userIntel.hateLevel > 100) {
      this.addUserHateLevel(username, -100)
    }
  }

  if (!config.diplomacy) {
    return
  }

  const tasks = Object.values(Overlord.getTasksWithCategory('harass'))

  const usernames = Object.keys(Memory.users).sort((a, b) => Math.random() - 1)

  user: for (const username of usernames) {
    const userIntel = this.getUserIntel(username)

    if (!userIntel.hateLevel || userIntel.hateLevel < config.hateLevel.toHarass) {
      continue user
    }

    if (!userIntel.roomNames) {
      continue
    }

    const roomNames = [...userIntel.roomNames].sort((a, b) => getDepth(a) - getDepth(b))

    function getDepth(roomName) {
      const roomIntel = Overlord.getIntel(roomName)
      if (!roomIntel) {
        return Infinity
      }
      return roomIntel[scoutKeys.depth] || Infinity
    }

    const maxNum = Math.floor(userIntel.hateLevel / config.hateLevel.toHarass)

    let num = tasks.filter((task) => task.username === username).length

    console.log(`check ${username}. ${num}/${maxNum}. we know ${roomNames.length} rooms`)

    room: for (const roomName of roomNames) {
      if (num >= maxNum) {
        continue user
      }

      if (Overlord.getTask('harass', roomName)) {
        num++
        continue room
      }

      const roomIntel = this.getIntel(roomName)
      if (roomIntel[scoutKeys.lastHarassTick] && Game.time < roomIntel[scoutKeys.lastHarassTick] + 1000) {
        console.log(`recently harassed ${roomName}`)
        continue room
      }

      if (roomIntel[scoutKeys.depth] > 10) {
        console.log(`${roomName} depth ${roomIntel[scoutKeys.depth]}`)
        continue room
      }

      const closestMyRoom = Game.rooms[roomIntel[scoutKeys.closestMyRoom]]
      if (!closestMyRoom || !closestMyRoom.isMy || closestMyRoom.controller.level < roomIntel[scoutKeys.RCL]) {
        console.log(`closesetMyRoom ${roomIntel[scoutKeys.closestMyRoom]} Issue`)
        continue room
      }

      if (tasks.some((task) => task.roomNameInCharge === closestMyRoom.name)) {
        continue room
      }

      const request = new HarassRequest(closestMyRoom, username, roomName)

      Overlord.registerTask(request)
      tasks.push(request)

      num++
      continue room
    }

    console.log(`checked ${username}. ${num}/${maxNum}.`)
  }
}

Overlord.getUsernames = function () {}

Overlord.addUserHateLevel = function (username, amount) {
  const userIntel = this.getUserIntel(username)
  userIntel.hateLevel = userIntel.hateLevel || 0
  userIntel.hateLevel += amount
}

Overlord.addUserRoom = function (username, roomName) {
  const userIntel = this.getUserIntel(username)
  userIntel.rooms = userIntel.rooms || {}
  userIntel.rooms[roomName] = userIntel.rooms[roomName] || {}
}

Overlord.deleteUserRoom = function (username, roomName) {
  const userIntel = this.getUserIntel(username)
  userIntel.rooms = userIntel.rooms || {}
  delete userIntel.rooms[roomName]
}

Overlord.getUserIntel = function (username) {
  Memory.users[username] = Memory.users[username] || {}
  return Memory.users[username]
}
