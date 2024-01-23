const VISUALIZE_GOAL = true
const VISUALIZE_MOVE = false
const VISUALIZE_PATH_TO_MAP = false

Creep.prototype.moveToRoom = function (goalRoomName, ignoreMap) {
    if (ignoreMap === undefined) {
        ignoreMap = this.memory.ignoreMap || 1
    }

    const target = new RoomPosition(25, 25, goalRoomName)

    if (this.room.name === goalRoomName) {
        this.setWorkingInfo(target, 23)
    }

    return this.moveMy({ pos: target, range: 23 }, { ignoreMap })
}

/**
 * 
 * @param {Object} goals - Either goal {pos, range} or array of goals.
 * @param {Object} options - Object containing following options
 * @param {boolean} options.staySafe - if true, don't go outside of protected area.
 * @param {number} options.ignoreMap - at 0, don't pass through inassessible roons. at 1, ignore assessibility of target room. at 2, totally ignore assessibility.
 * @param {boolean} ignoreCreeps - if true, ignore creeps
 * @param {boolean} ignoreOrder - if true, ignore scheduled move
 * @returns {Constant} OK - The creep is arrived to target or move action is scheduled
 * @returns {Constant} ERR_BUSY - The creep is spawning or staying or already moved
 * @returns {Constant} ERR_TIRED - 	The fatigue indicator of the creep is non-zero.
 * @returns {Constant} ERR_NOT_FOUND - there's no nextPos
 * @returns {Constant} ERR_NO_PATH - there's no route or PathFinder failed
 * @returns {Constant} ERR_INVALID_TARGET - Tried swapPos but failed. target is not my creep or cannot move
 * @returns {Constant} ERR_NOT_IN_RANGE - Tried swapPos but failed. target is not adjacent
 */
Creep.prototype.moveMy = function (goals, options = {}) { //option = {staySafe, ignoreMap}
    const defaultOptions = {
        staySafe: (this.room.memory.militaryThreat && this.room.isWalledUp),
        ignoreMap: (this.memory.ignoreMap || 1),
        ignoreCreeps: true,
        ignoreOrder: false,
        visualize: false,
    }
    const mergedOptions = { ...defaultOptions, ...options }

    const { staySafe, ignoreMap, ignoreCreeps, ignoreOrder, visualize } = mergedOptions

    goals = normalizeGoals(goals)

    if (goals.length === 0) {
        return ERR_INVALID_TARGET
    }

    const mainTargetPos = goals[0].pos

    //도착했으면 기억 지우고 return
    if (this.pos.isInGoal(goals)) {
        this.resetPath()
        return OK
    }


    if (!ignoreOrder && this._moved) {
        this.say(`❌`, true)
        return ERR_BUSY
    }

    //spawn 중이면 return
    if (this.spawning) {
        return ERR_BUSY
    }

    // stay 중이면 return
    if (this.heap.stay) {
        if (this.heap.stay > Game.time) {
            this.room.visual.line(this.pos, mainTargetPos, { color: 'red', lineStyle: 'dashed' })
            this.say(`🛌${this.heap.stay - Game.time}`, true)
            this.moveTo(mainTargetPos)
            return ERR_NO_PATH
        } else {
            delete this.heap.stay
            if (this.memory.role !== 'scouter' && !this.memory.notifiedStuck) {
                this.memory.notifiedStuck = true
            }
        }
    }

    //fatigue 있으면 return
    if (this.fatigue) {
        return ERR_TIRED
    }

    if (this.needNewPath(goals)) {
        this.resetPath()
        const moveCost = this.getMoveCost()
        const result = this.searchPath(goals, { ignoreCreeps, staySafe, ignoreMap, moveCost })
        // 도착지까지 길이 안찾아지는 경우
        if (result === ERR_NO_PATH) {
            this.heap.noPath = this.heap.noPath || 0
            this.heap.noPath++
            this.say(`❓${this.heap.noPath}`, true)
            if (this.heap.noPath > 1) {
                this.heap.stay = Game.time + 10
            }
            return ERR_NO_PATH
        }

        // 찾아진 경우
        delete this.heap.noPath
        this.heap.path = result
    }

    // 직전 위치랑 지금 위치가 같은 경우
    if (this.checkStuck()) {
        this.heap.stuck = this.heap.stuck || 0
        this.heap.stuck++
        this.heap.lastPos = this.pos
        this.heap.lastPosTick = Game.time
    } else {
        this.heap.stuck = 0
    }

    if (this.heap.stuck >= 5) {
        this.say(`🚧`, true)
        const doIgnoreCreeps = Math.random() < 0.5
        const result = this.searchPath(goals, { staySafe, ignoreMap, ignoreCreeps: doIgnoreCreeps })
        if (result === ERR_NO_PATH) {
            this.heap.noPath = this.heap.noPath || 0
            this.heap.noPath++
            this.say(`❓${this.heap.noPath}`, true)
            if (this.heap.noPath > 1) {
                this.heap.stay = Game.time + 10
            }
            return ERR_NO_PATH
        }

        this.heap.stuck = 0
        this.heap.path = result
    }
    this.heap.lastPos = this.pos
    this.heap.lastPosTick = Game.time

    // path의 첫번째에 도착했으면 첫 번째를 지우자
    if (this.heap.path[0] && this.pos.isEqualTo(this.heap.path[0])) {
        this.heap.path.shift()
    }

    if (visualize) {
        visualizePath(this.heap.path, this.pos)
    }

    // 다음꺼한테 가자
    const nextPos = this.heap.path[0]

    if ((VISUALIZE_MOVE || TRAFFIC_TEST) && nextPos) {
        this.room.visual.arrow(this.pos, nextPos, { color: 'red', opacity: 1 })
    }

    // 다음꺼 없거나 다음꺼가 멀면 뭔가 잘못된거니까 리셋
    if (!nextPos) {
        this.resetPath()
        this.say('🚫', true)
        return ERR_NOT_FOUND
    }

    const path = this.heap.path
    const goal = path[path.length - 1]

    //같은 방에 있으면 목적지 표시. 다른 방에 있으면 지도에 표시
    if (goal && this.pos.roomName === goal.roomName) {
        if (VISUALIZE_GOAL === true) {
            this.room.visual.line(this.pos, goal, { color: 'yellow', lineStyle: 'dashed' })
        }
    } else if (VISUALIZE_PATH_TO_MAP && this.heap.path && this.heap.path.length > 0) {
        Game.map.visual.poly(this.heap.path, { stroke: '#ffe700', strokeWidth: 1, opacity: 0.75 })
    }

    if (this.pos.roomName !== nextPos.roomName || this.pos.getRangeTo(nextPos) > 1) {
        this.resetPath()
        this.say('🛑', true)
        return ERR_NOT_FOUND
    }

    this.setNextPos(nextPos)

    // 움직였으니까 _moved 체크
    this._moved = true

    // 여기는 validCoord인데 다음꺼는 validCoord가 아니면 이제 방의 edge인거다. 다음꺼를 지우자.
    if (!isEdgeCoord(this.pos.x, this.pos.y) && isEdgeCoord(nextPos.x, nextPos.y)) {
        this.heap.path.shift()
    }
    return OK
}

global.normalizeGoals = function (goals) {
    goals = Array.isArray(goals) ? goals : [goals]
    const result = []
    for (let i = 0; i < goals.length; i++) {
        const goal = goals[i]

        if (!goal) {
            continue
        }

        const pos = goal.pos || goal
        if (!RoomPosition.prototype.isPrototypeOf(pos)) {
            continue
        }

        const range = goal.range || 0
        if (isNaN(range)) {
            continue
        }

        result.push({ pos, range })
    }
    return result
}

Creep.prototype.getCost = function () {
    const body = this.body

    let result = 0

    for (const part of body) {
        let multiplier = 1
        const boost = part.boost
        if (boost) {
            if (Object.keys(TIER1_COMPOUNDS).includes(boost)) {
                multiplier = 2
            } else if (Object.keys(TIER2_COMPOUNDS).includes(boost)) {
                multiplier = 3
            } else if (Object.keys(TIER3_COMPOUNDS).includes(boost)) {
                multiplier = 4
            }
        }
        result += (BODYPART_COST[part.type] * multiplier)
    }

    return result
}

// pos is roomPosition
Creep.prototype.checkEmpty = function (pos) {
    const creep = pos.lookFor(LOOK_CREEPS)[0]
    if (!creep) {
        return OK
    }
    if (this.id === creep.id) {
        return OK
    }
    return creep
}

Creep.prototype.moveRandom = function () {
    const costs = this.room.basicCostmatrix
    const adjacents = this.pos.getAtRange(1).filter(pos => costs.get(pos.x, pos.y) < 255)
    const index = Math.floor(Math.random() * adjacents.length)
    const targetPos = adjacents[index]
    this.moveMy(targetPos)
}

/**
 * get move cost of a creep.
 * @returns cost for movement on road. plain is *2 and swamp is *10
 */
Creep.prototype.getMoveCost = function () {
    let burden = 0
    let move = 0
    let usedCapacity = this.store.getUsedCapacity()
    for (const part of this.body) {
        if (part.type === MOVE) {
            if (part.hits === 0) {
                continue
            }
            move += (part.boost === 'XZHO2' ? 8 : part.boost === 'ZHO2' ? 6 : part.boost === 'ZO' ? 4 : 2)
            continue
        }
        if (part.type === CARRY) {
            if (usedCapacity > 0) {
                burden += 1
                usedCapacity -= 50
                continue
            }
            continue
        }
        burden += 1
        continue
    }
    return burden / move
}

Creep.prototype.getEnergyFrom = function (id) {
    const target = Game.getObjectById(id)
    if (!target || (!target.amount && !(target.store && target.store[RESOURCE_ENERGY]))) {
        return ERR_INVALID_TARGET
    }
    if (this.pos.getRangeTo(target) > 1) {
        this.moveMy({ pos: target.pos, range: 1 })
        return ERR_NOT_IN_RANGE
    }
    this.setWorkingInfo(target.pos, 1)
    if (this.withdraw(target, RESOURCE_ENERGY) === OK) {
        return OK
    }
    return this.pickup(target)
}

/**
 * 
 * @param {array} goals - an array of goals {pos, range}. should be in normalized form.
 * @param {object} options 
 * @returns ERR_NO_PATH if there is no path. otherwise path(an array of roomPositions)
 */
Creep.prototype.searchPath = function (goals, options = {}) {
    return Overlord.findPath(this.pos, goals, options)
}

global.visualizePath = function (path, startPos) {
    for (let i = path.length - 1; i >= 0; i--) {
        const posNow = path[i]
        const posNext = path[i - 1] || startPos
        if (!posNext) {
            return
        }
        if (posNow.roomName === posNext.roomName) {
            new RoomVisual(posNow.roomName).line(posNow, posNext, {
                color: 'aqua', width: .15,
                opacity: .2, lineStyle: 'dashed'
            })
        }
        if (startPos && posNext.isEqualTo(startPos)) {
            return
        }
    }
}

Creep.prototype.searchBattlePath = function (target, range = 1, maxRooms = 16) {
    const result = PathFinder.search(this.pos, { pos: (target.pos || target), range: range }, {
        plainCost: 2,
        swampCost: 10,
        roomCallback: function (roomName) {
            if (roomName === (target.roomName || target.room.name))
                return Game.rooms[roomName].costmatrixForBattle
        },
        maxRooms: maxRooms
    })
    this.memory.path = result.path
    return result
}

Creep.prototype.resetPath = function () {
    delete this.heap.path
    delete this.heap.stuck
    delete this.heap.lastPos
}

/**
 * 
 * @param {array} goals - an array of goals {pos, range}. should be in normalized form.
 * @returns {boolean} - whether this creep needs new path or not
 */
Creep.prototype.needNewPath = function (goals) {
    //원래 target이 있었는데 지금 target이랑 다르거나, heap에 path가 없거나, heap에 있는 path가 비어있으면 새롭게 길 찾자
    if (!this.heap.path) {
        return true
    }

    if (this.heap.path.length === 0) {
        return true
    }

    if (this.pos.getRangeTo(this.heap.path[0]) > 1) {
        return true
    }

    const cachedPath = this.heap.path
    const cachedPathLastPos = cachedPath[cachedPath.length - 1]
    if (cachedPathLastPos.isInGoal(goals)) {
        return false
    }

    return true
}

RoomPosition.prototype.isInGoal = function (goals) {

    for (const goal of goals) {
        if (this.roomName !== goal.pos.roomName) {
            continue
        }
        if (this.getRangeTo(goal.pos) <= goal.range) {
            return true
        }
    }

    return false
}

Creep.prototype.checkStuck = function () {
    if (!this.heap.lastPos) {
        return false
    }
    if (!this.heap.lastPosTick) {
        return false
    }
    if ((Game.time - this.heap.lastPosTick) !== 1) {
        return false
    }
    if (isEdgeCoord(this.heap.lastPos.x, this.heap.lastPos.y) && isEdgeCoord(this.pos.x, this.pos.y)) {
        return true
    }
    return this.pos.isEqualTo(this.heap.lastPos)
}

Creep.prototype.getRecycled = function () {
    const closestSpawn = this.pos.findClosestByRange(this.room.structures.spawn.filter(s => !s.spawning))

    if (closestSpawn) {
        if (this.pos.getRangeTo(closestSpawn) > 1) {
            this.moveMy({ pos: closestSpawn.pos, range: 1 })
            return
        }
        closestSpawn.recycleCreep(this)
        return
    }

    const anySpawn = this.room.structures.spawn[0]
    if (anySpawn) {
        if (this.pos.getRangeTo(anySpawn) > 2) {
            this.moveMy({ pos: anySpawn.pos, range: 1 })
        }
        return
    }
    this.suicide()
    return
}

Creep.prototype.getNumParts = function (partsName) {
    return this.body.filter(part => part.type === partsName).length
}

Creep.prototype.checkBodyParts = function (type) {
    if (!Array.isArray(type)) {
        type = [type]
    }
    return this.body.find(part => type.includes(part.type)) ? true : false
}