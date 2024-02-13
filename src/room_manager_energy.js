const TERMINAL_ENERGY_THRESHOLD_MAX_RCL = 20000
const TERMINAL_ENERGY_THRESHOLD_LOW_RCL = 10000
const TERMINAL_ENERGY_BUFFER = 3000

const { config } = require('./config')
let MinHeap = require('./util_min_heap')

const ENERGY_PRIORITY = {
    extension: 1,
    spawn: 1,
    lab: 1,
    tower: 1,
    link: 1,
    container: 2,
    terminal: 7,
    factory: 9,
    nuker: 10,
    storage: 11,
}

global.ENERGY_DEPOT_PRIORITY = {
    link: 3,
    container: 2,
    storage: 4,
    terminal: 3,
}

function EnergyRequest(creep) {
    this.id = creep.id
    this.creep = creep
    this.pos = creep.pos
    this.amount = creep.store.getFreeCapacity()
    this.reserved = undefined
}

function EnergyDepot(depot) {
    this.id = depot.id
    this.pos = depot.pos
    this.priority = ENERGY_DEPOT_PRIORITY[depot.structureType] || (depot.destroyTime ? 2 : 1)
    this.amount = depot.amount || depot.store[RESOURCE_ENERGY]
}

function Applicant(creep) {
    this.id = creep.id
    this.creep = creep
    this.pos = creep.pos
    this.amount = creep.store.getUsedCapacity(RESOURCE_ENERGY)
    this.isManager = creep.memory.role === 'manager' ? true : false
    this.engaged = null
    this.married = false
    this.giveEnergy = false
}

function Request(client) {
    this.id = client.id
    this.pos = client.pos
    this.amount = client.store.getFreeCapacity(RESOURCE_ENERGY)

    if (client.structureType) {
        this.priority = ENERGY_PRIORITY[client.structureType]
    } else if (!client.working || client.memory.idBuilder) {
        this.priority = 3
        this.amount += client.store.getCapacity()
    } else if ((client.store.getUsedCapacity() / client.store.getCapacity()) < 0.5) {
        this.priority = 4
        this.amount += client.store.getCapacity()
    } else {
        this.priority = 5
        this.amount += client.store.getCapacity()
    }

    // new RoomVisual(this.pos.roomName).text(this.priority, this.pos) // for debug
}

Room.prototype.manageEnergy = function () {
    let suppliers = []
    let fetchers = []
    const haulers = this.creeps.hauler.concat(this.creeps.manager)
    const remoteHaulers = this.getSupplyingRemoteHaulers()

    outer:
    for (const researcher of this.creeps.researcher) {
        if (researcher.isFree) {
            for (const resourceType in researcher.store) {
                if (resourceType !== RESOURCE_ENERGY) {
                    researcher.returnAll()
                    continue outer
                }
            }
            haulers.push(researcher)
        }
    }

    for (const remoteHauler of remoteHaulers) {
        haulers.push(remoteHauler)
    }

    outer:
    for (const creep of haulers) {
        if (creep.ticksToLive < 15) {
            creep.getRecycled()
            continue
        }

        for (const resourceType in creep.store) {
            if (resourceType !== RESOURCE_ENERGY) {
                creep.returnAll()
                continue outer
            }
        }

        if (creep.supplying) {
            suppliers.push(creep)
            continue
        }
        fetchers.push(creep)
    }

    this.manageEnergySupply(suppliers)
    this.manageEnergyFetch(fetchers)
    this.manageHub()
}

Room.prototype.manageHub = function () {
    const distributor = this.creeps.distributor[0]

    if (!distributor) {
        return
    }

    const hubCenterPos = this.getHubCenterPos()
    if (!hubCenterPos) {
        return
    }

    if (distributor.pos.getRangeTo(hubCenterPos) > 0) {
        distributor.moveMy(hubCenterPos)
        return
    }

    if (distributor.ticksToLive < 1000) {
        const freeSpawn = this.structures.spawn.find(spawn => !spawn.spawning)
        if (freeSpawn) {
            freeSpawn.renewCreep(distributor)
        }
    }

    if (distributor.supplying) {
        this.supplyHub(distributor)
        return
    }

    this.fetchHub(distributor)
}

Room.prototype.getHubCenterPos = function () {
    if (this._hubCenterPos !== undefined) {
        return this._hubCenterPos
    }

    if (Math.random() < 0.01) {
        delete this.heap.hubCenterPos
    }

    if (this.heap.hubCenterPos !== undefined) {
        return this._hubCenterPos = this.heap.hubCenterPos
    } else {
    }

    const storage = this.storage
    const storageLink = storage ? storage.link : undefined

    if (!storage || !storageLink) {
        return this._hubCenterPos = this.heap.hubCenterPos = null
    }

    const spawns = this.structures.spawn
    if (!storage || !storageLink) {
        return this._hubCenterPos = this.heap.hubCenterPos = null
    }

    const positions = storage.pos.getAtRange(1)
    const hubCenterPos = positions.find(pos => {
        if (pos.getRangeTo(storageLink) !== 1) {
            return false
        }
        for (const spawn of spawns) {
            if (pos.getRangeTo(spawn) !== 1) {
                return false
            }
        }
        return true
    })

    return this._hubCenterPos = this.heap.hubCenterPos = hubCenterPos
}

Creep.prototype.getTargetId = function () {
    return this.heap.targetId
}

Creep.prototype.resetTargetId = function () {
    delete this.heap.targetId
}

Room.prototype.fetchHub = function (distributor) {
    const storageLink = this.storage ? this.storage.link : undefined
    if (storageLink && storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 400 && !this.heap.emptyControllerLink) {
        distributor.getEnergyFrom(storageLink.id)
        return
    }

    const level = this.controller ? this.controller.level : undefined
    const terminal = this.terminal
    if (terminal && terminal.store[RESOURCE_ENERGY] > ((level === 8 ? TERMINAL_ENERGY_THRESHOLD_MAX_RCL : TERMINAL_ENERGY_THRESHOLD_LOW_RCL) + TERMINAL_ENERGY_BUFFER)) {
        distributor.getEnergyFrom(terminal.id)
        return
    }

    const storage = this.storage

    const hubEnergyRequestId = this.getHubEnergyRequestId()

    if (storage && hubEnergyRequestId) {
        distributor.getEnergyFrom(storage.id)
        distributor.setTargetId(hubEnergyRequestId)
    }
}

Room.prototype.supplyHub = function (distributor) {
    const targetId = distributor.getTargetId() || this.getHubEnergyRequestId()

    if (targetId) {
        distributor.giveEnergyTo(targetId)
        distributor.resetTargetId()
        return
    }

    const storage = this.storage

    if (storage) {
        distributor.giveEnergyTo(storage.id)
        return
    }
}

Room.prototype.getHubEnergyRequestId = function () {
    const spawnNotFull = this.structures.spawn.find(spawn => spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
    if (spawnNotFull) {
        return spawnNotFull.id
    }

    const storage = this.storage

    const storageLink = storage ? storage.link : undefined
    const controllerLink = this.controller.link

    const controllerLinkThreshold = this.laborer.numWork * 3

    if (controllerLink && storageLink && controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) < controllerLinkThreshold) {
        this.heap.emptyControllerLink = true
        if (storageLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            return storageLink.id
        }
    } else {
        this.heap.emptyControllerLink = false
    }

    const terminal = this.terminal

    if (terminal && terminal.store.getFreeCapacity(RESOURCE_ENERGY) && terminal.store[RESOURCE_ENERGY] < (this.controller.level > 7 ? TERMINAL_ENERGY_THRESHOLD_MAX_RCL : TERMINAL_ENERGY_THRESHOLD_LOW_RCL)) {
        return terminal.id
    }

    const powerSpawn = this.structures.powerSpawn[0]
    if (powerSpawn && powerSpawn.store[RESOURCE_POWER] > 0 && powerSpawn.store[RESOURCE_ENERGY] < powerSpawn.store[RESOURCE_POWER] * 50) {
        return powerSpawn.id
    }

    return undefined
}

Creep.prototype.setTargetId = function (targetId) {
    this.heap.targetId = targetId
}

Room.prototype.manageEnergySupply = function (arrayOfCreeps) {
    const requests = this.getEnergyRequests(arrayOfCreeps.length)
    if (requests.size === 0) {
        const spawn = this.structures.spawn[0]
        if (!spawn) {
            return
        }
        for (const creep of arrayOfCreeps) {
            creep.moveMy({ pos: spawn.pos, range: 3 })
        }
        return
    }
    const applicants = []
    for (const creep of arrayOfCreeps) {
        if (creep.heap.engaged) {
            const client = Game.getObjectById(creep.heap.engaged.id)
            const amountLeft = creep.store[RESOURCE_ENERGY] - creep.heap.engaged.amount

            delete creep.heap.engaged
            let pushed = false

            if (!client || client.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                applicants.push(new Applicant(creep))
                continue
            }
            // if energy supply is suceeded, creep is free again
            if (client && creep.transfer(client, RESOURCE_ENERGY) === OK) {

                if (amountLeft > 0) {
                    const applicant = new Applicant(creep)
                    applicant.amount = amountLeft
                    applicant.giveEnergy = true
                    applicants.push(applicant)
                    pushed = true
                }
            }

            const request = requests.get(client.id)
            if (request) {
                request.amount -= creep.store.getUsedCapacity(RESOURCE_ENERGY)
                if (!pushed) {
                    const applicant = new Applicant(creep)
                    applicant.engaged = request
                    applicant.married = true
                    applicants.push(applicant)
                }
            }
        } else {
            applicants.push(new Applicant(creep))
        }
    }

    const requestsArray = Array.from(requests.values())

    for (const request of requestsArray) {
        request.applicants = new MinHeap(a => a.pos.getRangeTo(request.pos))
        for (const applicant of applicants) {
            if (applicant.engaged && request.id === applicant.engaged.id) {
                continue
            }

            if (this.storage && applicant.creep.memory.role === 'colonyHauler' && applicant.pos.getRangeTo(request.pos) > 5) {
                continue
            }
            request.applicants.insert(applicant)
        }
    }

    while (true) {
        this.heap.storageUse = false
        const freeRequests = requestsArray.filter(request => {
            if (request.amount <= 0) {
                return false
            }

            if (request.applicants.getSize() === 0) {
                if (request.priority < ENERGY_PRIORITY['storage']) {
                    this.heap.storageUse = true
                }
                return false
            }

            return true
        })
        if (!freeRequests.length) {
            break
        }
        for (const request of freeRequests) {
            const bestApplicant = request.applicants.remove()
            if (!bestApplicant.engaged) {
                request.amount -= bestApplicant.amount
                bestApplicant.engaged = request
                continue
            }
            const existingRequest = bestApplicant.engaged
            if (existingRequest.priority < request.priority) {
                continue
            }

            if (existingRequest.priority === request.priority && (bestApplicant.pos.getRangeTo(existingRequest.pos) <= bestApplicant.pos.getRangeTo(request.pos) + (bestApplicant.married ? 2 : 0))) {
                continue
            }

            request.amount -= bestApplicant.amount
            existingRequest.amount += bestApplicant.amount
            bestApplicant.engaged = request
            bestApplicant.married = false
        }
    }
    const spawn = this.structures.spawn[0]
    for (const applicant of applicants) {
        const creep = applicant.creep
        if (applicant.engaged) {
            if (applicant.giveEnergy && applicant.pos.getRangeTo(applicant.engaged.pos) === 1) {
                creep.heap.engaged = applicant.engaged
                continue
            }

            if (creep.giveEnergyTo(applicant.engaged.id) !== OK) {
                creep.heap.engaged = applicant.engaged
            }
            continue
        }
        if (spawn) {
            creep.setWorkingInfo(spawn.pos, 3)
            creep.moveMy({ pos: spawn.pos, range: 3 })
        }
    }
}

Room.prototype.getEnergyRequests = function (numApplicants) {
    const controllerContainer = this.controller.container
    const storage = this.storage
    const factory = this.structures.factory[0]
    const nuker = this.structures.nuker[0]
    const terminal = this.terminal

    const requests = new Map()

    if (this.energyAvailable || 0 < this.energyCapacityAvailable) {
        for (const client of this.structures.extension) {
            if (client.store.getFreeCapacity(RESOURCE_ENERGY)) {
                requests.set(client.id, new Request(client))
            }
        }

        if (!this.getHubCenterPos() || this.creeps.distributor.length === 0) {
            for (const client of this.structures.spawn) {
                if (client.store.getFreeCapacity(RESOURCE_ENERGY)) {
                    requests.set(client.id, new Request(client))
                }
            }
        }
    }

    for (const client of this.structures.lab) {
        if (client.store.getUsedCapacity(RESOURCE_ENERGY) < 1000) {
            requests.set(client.id, new Request(client))
        }
    }

    for (const client of this.structures.tower) {
        if (client.store.getFreeCapacity(RESOURCE_ENERGY) > 400) {
            const request = new Request(client)
            requests.set(client.id, request)
        }
    }

    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY)) {
        requests.set(storage.id, new Request(storage))
    } else if (terminal && terminal.store.getFreeCapacity(RESOURCE_ENERGY)) {
        requests.set(terminal.id, new Request(terminal))
    }

    if (factory && factory.store.getFreeCapacity(RESOURCE_ENERGY) && factory.store.getUsedCapacity(RESOURCE_ENERGY) < 2000) {
        requests.set(factory.id, new Request(factory))
    }

    for (const creep of this.creeps.laborer) {
        if (creep.spawning) {
            continue
        }
        if (creep.needDelivery && creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            requests.set(creep.id, new Request(creep))
        }
    }

    if (!storage) {
        for (const creep of this.creeps.wallMaker) {
            if (creep.spawning) {
                continue
            }
            if (Game.time > creep.heap.deliveryCallTime + 1) {
                continue
            }
            requests.set(creep.id, new Request(creep))
        }
    }


    if (controllerContainer) {
        const amount = controllerContainer.store[RESOURCE_ENERGY]
        if (this.heap.refillControllerContainer && amount > 1900) {
            this.heap.refillControllerContainer = false
        } else if (!this.heap.refillControllerContainer && amount < 1500) {
            this.heap.refillControllerContainer = true
        }

        const request = new Request(controllerContainer)

        if (this.constructionSites.length > 0) {
            request.priority = 4
        }

        if (this.heap.refillControllerContainer) {
            requests.set(controllerContainer.id, request)
        }
    }

    if (nuker) {
        if (!this.memory.fillNuker && this.energyLevel >= config.energyLevel.FILL_NUKER) {
            this.memory.fillNuker = true
        } else if (this.memory.fillNuker && this.energyLevel < (config.energyLevel.FILL_NUKER - 10)) {
            this.memory.fillNuker = false
        }

        if (this.memory.fillNuker && nuker.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            requests.set(nuker.id, new Request(nuker))
        }
    }

    return requests
}

Room.prototype.getEnergyDepots = function () {
    const energyDepots = {}

    const tombstones = this.find(FIND_TOMBSTONES).filter(tombstone => tombstone.store[RESOURCE_ENERGY] > 50)
    for (const tombstone of tombstones) {
        const request = new EnergyDepot(tombstone)
        energyDepots[tombstone.id] = request
        energyDepots[tombstone.id].threshold = 50
    }

    const droppedResources = this.find(FIND_DROPPED_RESOURCES).filter(droppedResource => droppedResource.resourceType === RESOURCE_ENERGY && droppedResource.amount > 100)
    const filteredDroppedResources = droppedResources.filter(droppedResource => droppedResource.pos.getClosestRange(this.sources) > 1)
    for (const droppedResource of filteredDroppedResources) {
        const request = new EnergyDepot(droppedResource)
        energyDepots[droppedResource.id] = request
        energyDepots[droppedResource.id].threshold = 100
    }

    const ruins = this.find(FIND_RUINS).filter(ruin => ruin.store[RESOURCE_ENERGY] > 50)
    for (const ruin of ruins) {
        const request = new EnergyDepot(ruin)
        energyDepots[ruin.id] = request
        energyDepots[ruin.id].threshold = 50
    }

    for (const source of this.sources) {
        const droppedEnergies = source.droppedEnergies
        for (const droppedEnergy of droppedEnergies) {
            energyDepots[droppedEnergy.id] = new EnergyDepot(droppedEnergy)
            energyDepots[droppedEnergy.id].threshold = 10
            energyDepots[droppedEnergy.id].sourceId = source.id
        }

        const container = source.container
        if (container) {
            energyDepots[container.id] = new EnergyDepot(container)
            energyDepots[container.id].sourceId = source.id
        }
    }

    if (this.storage && this.heap.storageUse > 0) {
        energyDepots[this.storage.id] = new EnergyDepot(this.storage)
        energyDepots[this.storage.id].forManager = true
    }

    if (this.heap.isEnemy) {
        const defenseCostMatrix = this.defenseCostMatrix
        const result = {}
        for (const id in energyDepots) {
            const depot = energyDepots[id]
            for (const adjacentPos of depot.pos.getInRange(1)) {
                if (adjacentPos.isWall) {
                    continue
                }
                if (defenseCostMatrix.get(adjacentPos.x, adjacentPos.y) < DANGER_TILE_COST) {
                    if (depot.priority <= 2) {
                        depot.priority = 5
                    }
                    result[id] = depot
                    continue
                }
            }
        }
        return result
    }

    return energyDepots
}

Room.prototype.manageEnergyFetch = function (arrayOfCreeps) {
    if (!arrayOfCreeps.length) {
        return
    }
    const requests = this.getEnergyDepots()

    if (!Object.keys(requests).length) {
        return
    }

    const applicants = []
    const sourceApplicants = {}
    for (const source of this.sources) {
        sourceApplicants[source.id] = []
    }
    const managerApplicants = []

    for (const creep of arrayOfCreeps) {
        if (creep.heap.reserved) {
            const id = creep.heap.reserved.id
            const result = creep.getEnergyFrom(id)
            if (result !== ERR_INVALID_TARGET) {
                if (result === OK) {
                    delete creep.heap.reserved
                }
                if (requests[id]) {
                    requests[id].amount -= creep.store.getFreeCapacity()
                } else {
                    delete creep.heap.reserved
                }
                continue
            }
            delete creep.heap.reserved
        }
        const applicant = new EnergyRequest(creep)
        applicants.push(applicant)
        if (creep.memory.role === 'manager' || creep.memory.role === 'researcher') {
            managerApplicants.push(applicant)
            continue
        }
        if (creep.memory.sourceId && sourceApplicants[creep.memory.sourceId]) {
            sourceApplicants[creep.memory.sourceId].push(applicant)
        }
    }


    const requestsArray = Object.values(requests)

    for (const request of requestsArray) {
        request.applicants = new MinHeap(a => a.pos.getRangeTo(request.pos))

        if (request.amount <= (request.threshold || 0)) {
            continue
        }

        if (request.sourceId !== undefined) {
            for (const applicant of sourceApplicants[request.sourceId]) {
                request.applicants.insert(applicant)
            }
            continue
        }

        if (request.forManager) {
            for (const applicant of managerApplicants) {
                request.applicants.insert(applicant)
            }
            continue
        }

        for (const applicant of applicants) {
            request.applicants.insert(applicant)
        }
    }

    while (true) {
        const freeRequests = requestsArray.filter(request => (request.amount > (request.threshold || 0) && request.applicants.getSize()))
        if (!freeRequests.length) {
            break
        }
        for (const request of freeRequests) {
            const bestApplicant = request.applicants.remove()
            if (!request.threshold && bestApplicant.amount > request.amount) {
                continue
            }
            if (!bestApplicant.reserved) {
                request.amount -= bestApplicant.amount
                bestApplicant.reserved = request
                continue
            }
            const existingRequest = bestApplicant.reserved
            if (existingRequest.priority < request.priority) {
                continue
            }
            if (existingRequest.priority === request.priority && bestApplicant.pos.getRangeTo(existingRequest.pos) <= bestApplicant.pos.getRangeTo(request.pos)) {
                continue
            }
            request.amount -= bestApplicant.amount
            bestApplicant.reserved = request
        }
    }

    for (const applicant of applicants) {
        const creep = applicant.creep
        if (applicant.reserved) {
            if (creep.getEnergyFrom(applicant.reserved.id) !== OK) {
                creep.heap.reserved = applicant.reserved
            }
            continue
        }

        if (creep.memory.role === 'hauler' && !this.heap.isEnemy) {
            const source = Game.getObjectById(creep.memory.sourceId)
            if (source) {
                if (creep.heap.waitingPos) {
                    if (creep.pos.isEqualTo(creep.heap.waitingPos)) {
                        delete creep.heap.waitingPos
                        continue
                    }
                    creep.moveMy(creep.heap.waitingPos)
                    continue
                }
                const waitingPos = creep.pos.findClosestByRange(source.waitingArea.filter(pos => { return pos.walkable && (creep.checkEmpty(pos) === OK) }))
                if (waitingPos) {
                    creep.heap.waitingPos = waitingPos
                    creep.moveMy(waitingPos)
                    continue
                }
            }
        }

    }
}

Room.prototype.getSupplyingRemoteHaulers = function () {
    const creeps = this.find(FIND_MY_CREEPS)
    const supplyingRemoteHaulers = creeps.filter(creep => {
        return creep.memory.role === 'remoteHauler' && creep.memory.supplying
    })

    return supplyingRemoteHaulers
}