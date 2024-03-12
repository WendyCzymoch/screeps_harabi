const { RoomPostionUtils } = require('./util_roomPosition')

global.TRAFFIC_TEST = false

const CPU_CHECK = false

Room.prototype.manageTraffic = function () {
  const CPUbefore = CPU_CHECK ? Game.cpu.getUsed() : undefined

  const creeps = this.find(FIND_MY_CREEPS)

  const match = new Map()

  const movingCreeps = []

  for (const creep of creeps) {
    const packedCoord = RoomPostionUtils.packCoord(creep.pos)
    match.set(packedCoord, creep)
    if (creep.getNextPos()) {
      movingCreeps.push(creep)
    }
  }

  const visited = {}

  for (const creep of movingCreeps) {
    this.dfs(creep, visited, match)
  }

  let numMoved = 0
  for (const creep of creeps) {
    const matchedPos = creep._matchedPos
    if (matchedPos) {
      const direction = creep.pos.getDirectionTo(matchedPos)
      if (creep.move(direction) === OK) {
        numMoved++
      }
    }
  }

  if (CPU_CHECK) {
    const usedCPU = Game.cpu.getUsed() - CPUbefore - numMoved * 0.2
    console.log(`use ${(usedCPU / numMoved).toFixed(2)} cpu for each move`)
  }
}

/**
 *
 * @param {number} a - index of a creep in array of creeps
 * @param {array} creeps - array of creeps
 * @param {array} visited - array which represent if a creep is checked
 * @param {array} costs - costMatrix which represent index of the creep which is occupying that position
 */
Room.prototype.dfs = function (creep, visited, match) {
  visited[creep.name] = true

  if (creep._matchedPos) {
    return false
  }

  if (creep.fatigue > 0) {
    return false
  }

  const moveIntent = creep.getMoveIntent()

  while (moveIntent.length > 0) {
    const pos = moveIntent.shift()

    const packedCoord = RoomPostionUtils.packCoord(pos)

    const occupyingCreep = match.get(packedCoord)

    match.delete(RoomPostionUtils.packCoord(creep.pos))

    // there is no creep for that position
    if (!occupyingCreep) {
      match.set(packedCoord, creep)
      creep._matchedPos = pos
      return true
    }

    // there is a creep which is already checked. cannot push it.
    if (visited[occupyingCreep.name]) {
      continue
    }

    // there is a creep which can be pushed.
    if (this.dfs(occupyingCreep, visited, match)) {
      const newOccupyingCreep = match.get[packedCoord]
      if (newOccupyingCreep) {
        continue
      }
      match.set(packedCoord, creep)
      creep._matchedPos = pos
      return true
    }
  }

  // this creep cannot move.
  match.set(RoomPostionUtils.packCoord(creep.pos), creep)

  return false
}

Creep.prototype.setNextPos = function (pos) {
  this._nextPos = pos
}

Creep.prototype.getNextPos = function () {
  return this._nextPos
}

Creep.prototype.setWorkingInfo = function (pos, range) {
  this._workingInfo = { pos, range }
}

Creep.prototype.getWorkingInfo = function () {
  return this._workingInfo
}

Creep.prototype.getMoveIntent = function () {
  if (this._moveIntent !== undefined) {
    return this._moveIntent
  }

  const result = []

  if (this.fatigue > 0) {
    return result
  }

  const nextPos = this.getNextPos()
  if (nextPos) {
    result.push(nextPos)
    return (this._moveIntent = result)
  }

  const adjacents = this.pos.getAtRange(1).sort((a, b) => Math.random() - 0.5)

  const workingInfo = this.getWorkingInfo()

  if (workingInfo) {
    const targetPos = workingInfo.pos
    const range = workingInfo.range
    const positionsOutOfRange = []

    for (const pos of adjacents) {
      if (pos.isWall) {
        continue
      }
      if (isEdgeCoord(pos.x, pos.y)) {
        continue
      }

      if (!pos.walkable) {
        continue
      }

      if (pos.getRangeTo(targetPos) > range) {
        positionsOutOfRange.push(pos)
        continue
      }

      result.push(pos)
    }
    result.push(...positionsOutOfRange)

    return (this._moveIntent = result)
  }

  for (const pos of adjacents) {
    if (pos.isWall) {
      continue
    }
    if (isEdgeCoord(pos.x, pos.y)) {
      continue
    }
    if (!pos.walkable) {
      continue
    }
    result.push(pos)
  }

  return (this._moveIntent = result)
}
