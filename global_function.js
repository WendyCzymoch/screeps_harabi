/* Posted March 31st, 2018 by @semperrabbit*/

/**
 * global.hasRespawned()
 * 
 * @author:  SemperRabbit
 * @version: 1.1
 * @date:    180331
 * @return:  boolean whether this is the first tick after a respawn or not
 * 
 * The checks are set as early returns in case of failure, and are ordered
 * from the least CPU intensive checks to the most. The checks are as follows:
 * 
 *      If it has returned true previously during this tick, return true again
 *      Check Game.time === 0 (returns true for sim room "respawns")
 *      There are no creeps
 *      There is only 1 room in Game.rooms
 *      The 1 room has a controller
 *      The controller is RCL 1 with no progress
 *      The controller is in safemode with the initial value
 *      There is only 1 StructureSpawn
 *
 * The only time that all of these cases are true, is the first tick of a respawn.
 * If all of these are true, you have respawned.
 * 
 * v1.1 (by qnz): - fixed a condition where room.controller.safeMode can be SAFE_MODE_DURATION too
 *                - improved performance of creep number check (https://jsperf.com/isempty-vs-isemptyobject/23)
 */
global.hasRespawned = function hasRespawned() {
    // check for multiple calls on same tick    
    if (Memory.respawnTick && Memory.respawnTick === Game.time) {
        return true;
    }

    // server reset or sim
    if (Game.time === 0) {
        Memory.respawnTick = Game.time;
        return true;
    }

    // check for 0 creeps
    for (const creepName in Game.creeps) {
        return false;
    }

    // check for only 1 room
    const rNames = Object.keys(Game.rooms);
    if (rNames.length !== 1) {
        return false;
    }

    // check for controller, progress and safe mode
    const room = Game.rooms[rNames[0]];
    if (!room.controller || !room.controller.my || room.controller.level !== 1 || room.controller.progress ||
        !room.controller.safeMode || room.controller.safeMode <= SAFE_MODE_DURATION - 1) {
        return false;
    }

    // check for 1 spawn
    if (Object.keys(Game.spawns).length > 1) {
        return false;
    }

    // if all cases point to a respawn, you've respawned
    Memory.respawnTick = Game.time;
    return true;
}

global.resetRemote = function (roomName) {
    const myRooms = Overlord.myRooms
    for (const room of myRooms) {
        if (roomName && room.name !== roomName) {
            continue
        }
        delete room.memory.remotes
        delete room.memory.activeRemotes
        delete room.memory.coreRemotes
    }
}

/**
 * function to get room type with its name
 * @param {string} roomName 
 * @returns {string} type of room. highway / normal / center / sourceKeeper
 */
global.getRoomType = function (roomName) {
    const roomCoord = getRoomCoord(roomName)
    const x = (roomCoord.x) % 10
    const y = (roomCoord.y) % 10

    if (x === 0 || y === 0) {
        return 'highway'
    }

    if (x < 4 || x > 6 || y < 4 || y > 6) {
        return 'normal'
    }

    if (x === 5 && y === 5) {
        return 'center'
    }

    return 'sourceKeeper'
}

global.getRoomCoord = function (roomName) {
    roomName = roomName.name || roomName
    const roomCoord = roomName.match(/[a-zA-Z]+|[0-9]+/g)
    roomCoord[1] = Number(roomCoord[1])
    roomCoord[3] = Number(roomCoord[3])
    const x = roomCoord[1]
    const y = roomCoord[3]
    return { x, y }
}

global.isValidCoord = function (x, y) {
    return x >= 0 && x <= 49 && y >= 0 && y <= 49
}

global.isEdgeCoord = function (x, y) {
    return x === 0 || x === 49 || y === 0 || y === 49
}

global.packCoord = function (x, y) {
    return 50 * y + x
}
global.parseCoord = function (packed) {
    const x = packed % 50
    const y = (packed - x) / 50
    return { x, y }
}

global.info = function () {
    if (data.info) {
        data.info = false
        return 'hide info'
    } else {
        data.info = true
        return 'show info'
    }
}

global.autoClaim = function () {
    if (Memory.autoClaim) {
        Memory.autoClaim = false
        return 'deactivate automated claim'
    } else {
        Memory.autoClaim = true
        return 'atcivate automated claim'
    }
}

global.basePlan = function (roomName, numIteration = 10) {

    data.observe = { roomName: roomName.toUpperCase(), tick: numIteration + 5 }
    return `observe room and get basePlan ${roomName.toUpperCase()} start`
}

/**
 * 
 * @param {array} array - array of object 
 * @param {function} func - function to calculate value 
 * @returns - object which has maximum function value. undefined if array is empty
 */
global.getMaxObject = function (array, func) {
    if (!array.length) {
        return undefined
    }
    let maximumPoint = array[0]
    let maximumValue = func(maximumPoint)
    for (const point of array) {
        const value = func(point)
        if (value > maximumValue) {
            maximumPoint = point
            maximumValue = value
        }
    }
    return maximumPoint
}

global.getMinObject = function (array, func) {
    if (!array.length) {
        return undefined
    }
    let minimumPoint = array[0]
    for (const point of array) {
        if (func(point) < func(minimumPoint)) {
            minimumPoint = point
        }
    }
    return minimumPoint
}

global.abandon = function (roomName) {
    if (!Memory.abandon) {
        Memory.abandon = []
    }
    Memory.abandon.push(roomName)
}

global.checkCPU = function (name) {
    if (!Game._cpu) {
        Game._cpu = Game.cpu.getUsed()
    }

    if (!name) {
        Game._cpu = Game.cpu.getUsed()
        return
    }

    const cpu = Game.cpu.getUsed()
    const cpuUsed = cpu - Game._cpu
    if (cpuUsed > 0) {
        console.log(`tick: ${Game.time} | name: ${name} | used: ${cpuUsed} at `)
    }
    Game._cpu = cpu
}

global.colonize = function (remoteName, baseName) {
    remoteName = remoteName.toUpperCase()
    const base = baseName ? Game.rooms[baseName.toUpperCase()] : Overlord.findClosestMyRoom(colonyName, 4)
    if (!base || !base.isMy) {
        console.log('invalid base')
        return
    }

    const distance = Game.map.getRoomLinearDistance(baseName, remoteName)

    if (distance > 2) {
        console.log(`Remote ${remoteName} is too far from your base ${baseName}. distance is ${distance}`)
        return
    }

    base.memory.remotes = base.memory.remotes || {}
    base.memory.remotes[remoteName] = base.memory.remotes[remoteName] || {}

    Memory.rooms[remoteName] = Memory.rooms[remoteName] || {}
    Memory.rooms[remoteName].host = base.name

    console.log(`${baseName} colonize ${remoteName}. distance is ${distance}`)
    return OK
}

global.claim = function (targetRoomName, baseName) {
    targetRoomName = targetRoomName.toUpperCase()
    const base = baseName ? Game.rooms[baseName.toUpperCase()] : Overlord.findClosestMyRoom(targetRoomName, 4)
    baseName = base.name
    base.memory.claimRoom = base.memory.claimRoom || {}
    base.memory.claimRoom[targetRoomName] = base.memory.claimRoom[targetRoomName] || {}
    return `${baseName} starts claim protocol to ${targetRoomName}`
}

global.cancelAllClaim = function () {
    const myRooms = Overlord.myRooms
    for (const room of myRooms) {
        delete room.memory.claimRoom
    }
}

global.visual = function () {
    if (data.visualize) {
        data.visualize = false
        data.info = true
        return "hide basePlan"
    }
    data.visualize = true
    data.info = false
    return "show basePlan"
}

global.resetScout = function (roomName) {
    if (roomName === undefined) {
        for (const myRoom of Overlord.myRooms) {
            delete myRoom.memory.scout
            const scouters = Overlord.getCreepsByRole(myRoom.name, 'scouter')
            for (const scouter of scouters) {
                scouter.suicide()
            }
        }
        return 'reset scout'
    } else {
        roomName = roomName.toUpperCase()
        const room = Game.rooms[roomName]
        if (!room || !room.isMy) {
            return 'invalid roomName'
        }
        delete room.memory.scout
        const scouter = Overlord.getCreepsByRole(roomName, 'scouter')[0]
        if (scouter) {
            scouter.suicide()
        }
        return `reset scout of ${roomName}`
    }
}

global.link = function () {
    for (const myRoom of Overlord.myRooms) {
        console.log(myRoom.hyperLink)
    }
}

global.mapInfo = function () {
    Memory.showMapInfo = (Memory.showMapInfo || 0) ^ 1
    if (Memory.showMapInfo === 1) {
        Memory.mapInfoTime = Game.time
    }
    return `show map visual : ${Memory.showMapInfo}`
}

global.logSend = function (resourceType) {
    const outgoingTransactions = Game.market.outgoingTransactions

    let i = 0
    for (const transaction of outgoingTransactions) {
        i++
        if (resourceType && transaction.resourceType !== resourceType) {
            continue
        }
        console.log(`tick${transaction.time}: ${transaction.from} sent ${transaction.amount} of ${transaction.resourceType} to ${transaction.recipient ? transaction.recipient.username : 'NPC'}(${transaction.to})`)
        if (i > 50) {
            break
        }
    }
}

global.logReceive = function (resourceType) {
    const incomingTransactions = Game.market.incomingTransactions
    let i = 0
    for (const transaction of incomingTransactions) {
        i++
        if (resourceType && transaction.resourceType !== resourceType) {
            continue
        }
        console.log(`tick${transaction.time}: ${transaction.to} got ${transaction.amount} of ${transaction.resourceType} from ${transaction.sender ? transaction.sender.username : 'NPC'}(${transaction.from})`)
        if (i > 50) {
            break
        }
    }
}

global.setRampartsHits = function (roomName, threshold = undefined) {
    roomName = roomName.toUpperCase()
    const room = Game.rooms[roomName]
    if (!room || !room.isMy) {
        return
    }
    if (threshold) {
        room.memory.rampartsHitsPerRcl = threshold
    } else {
        delete room.memory.rampartsHitsPerRcl
    }
    return
}

global.parseBody = function (str) {
    const shorts = { "m": "move", "w": "work", "c": "carry", "a": "attack", "r": "ranged_attack", "h": "heal", "t": "tough", "cl": "claim" };
    let res = [];
    for (let i = 0; i < str.length;) {
        let count = str[i++];
        if (str[i] >= '0' && str[i] <= '9') {
            count += str[i++];
        }
        let label = str[i++];
        if (str[i] === 'l') {
            label += str[i++];
        }
        while (count--) res.push(shorts[label]);
    }
    return res;
}