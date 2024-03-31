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

  const usernames = Object.keys(Memory.users).sort((a, b) => Math.random() - 0.5)

  user: for (const username of usernames) {
    const userIntel = this.getUserIntel(username)

    if (!userIntel.hateLevel || userIntel.hateLevel < config.hateLevel.toHarass) {
      continue user
    }

    if (!userIntel.roomNames) {
      continue
    }

    const roomNames = [...userIntel.roomNames].sort((a, b) => Math.random() - 0.5)

    const maxNum = Math.floor(userIntel.hateLevel / config.hateLevel.toHarass)

    let num = tasks.filter((task) => task.username === username).length

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
        continue room
      }

      if (roomIntel[scoutKeys.depth] > 10) {
        continue room
      }

      const closestMyRoom = Game.rooms[roomIntel[scoutKeys.closestMyRoom]]
      if (!closestMyRoom || !closestMyRoom.isMy || closestMyRoom.controller.level < roomIntel[scoutKeys.RCL]) {
        continue room
      }

      if (tasks.filter((task) => task.roomNameInCharge === closestMyRoom.name) > 2) {
        continue room
      }

      const request = new HarassRequest(closestMyRoom, username, roomName)

      Overlord.registerTask(request)
      tasks.push(request)

      num++
      continue room
    }
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
