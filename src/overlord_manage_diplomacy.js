const { config } = require('./config')
const { HarassRequest } = require('./overlord_tasks_harass')

Memory.users = Memory.users || {}

Overlord.manageDiplomacy = function () {
  if (Math.random() < 0.001) {
    for (const username in Memory.username) {
      const userIntel = this.getUserIntel(username)
      userIntel.hateLevel = Math.floor(userIntel.hateLevel * 0.9)
    }
  }

  if (!config.diplomacy) {
    return
  }

  if (Math.random() < 0.01) {
    user: for (const username in Memory.username) {
      const userIntel = this.getUserIntel(username)
      if (userIntel.hateLevel > config.hateLevel.toHarass) {
        const roomNames = [...userIntel.roomNames].sort((a, b) => getDepth(a) - getDepth(b))

        function getDepth(roomName) {
          const roomIntel = this.getIntel(roomName)
          if (!roomIntel) {
            return Infinity
          }
          return roomIntel[scoutKeys.depth] || Infinity
        }

        const maxNum = Math.floor(userIntel.hateLevel / config.hateLevel.toHarass)

        let num = 0
        room: for (const roomName of roomNames) {
          const roomIntel = this.getIntel(roomName)
          if (Game.time < roomIntel[scoutKeys.lastHarassTick] + 1000) {
            continue room
          }
          if (roomIntel[scoutKeys.closestMyRoom] && roomIntel[scoutKeys.depth] < 10) {
            const closestMyRoom = Game.rooms[roomIntel[scoutKeys.closestMyRoom]]
            if (!closestMyRoom || !closestMyRoom.isMy || closestMyRoom.controller.level < 3) {
              continue room
            }
            const request = new HarassRequest(closestMyRoom, roomName)
            Overlord.registerTask(request)
            num++
            if (num >= maxNum) {
              continue user
            } else {
              continue room
            }
          }
        }
      }
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
