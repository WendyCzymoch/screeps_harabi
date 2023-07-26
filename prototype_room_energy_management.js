const ENERGY_PRIORITY = {
    extension: 1,
    spawn: 1,
    tower: 1,
    link: 1,
    container: 6,
    terminal: 7,
    factory: 8,
    nuker: 9,
    storage: 10,
}

global.ENERGY_DEPOT_PRIORITY = {
    link: 3,
    container: 2,
    storage: 4,
    terminal: 3,
}

function Applicant(creep) {
    this.id = creep.id
    this.creep = creep
    this.pos = creep.pos
    this.amount = creep.store.getUsedCapacity(RESOURCE_ENERGY)
    this.isManager = creep.memory.role === 'manager' ? true : false
    this.engaged = null
}

function Request(client) {
    this.id = client.id
    this.client = client
    this.pos = client.pos
    this.priority = ENERGY_PRIORITY[client.structureType] || (!client.working ? 3 : ((client.store.getUsedCapacity() / client.store.getCapacity()) > 0.5 ? 5 : 4))
    this.amount = client.store.getFreeCapacity(RESOURCE_ENERGY)
    // new RoomVisual(this.pos.roomName).text(this.priority, this.pos) // for debug
}

Room.prototype.getEnergyRequests = function (numApplicants) {
    const storageLink = this.storage ? this.storage.link : null
    const controllerLink = this.controller.link
    const controllerContainer = this.controller.container
    const terminal = this.terminal
    const storage = this.storage
    const factory = this.structures.factory[0]
    const nuker = this.structures.nuker[0]

    const requests = {}
    const energyLevelThreshold = this.memory.hasOperator ? 0.5 : 1
    if (this.energyAvailable < energyLevelThreshold * this.energyCapacityAvailable) {
        for (const client of this.structures.extension) {
            if (client.store.getFreeCapacity(RESOURCE_ENERGY)) {
                requests[client.id] = new Request(client)
            }
        }

        for (const client of this.structures.spawn) {
            if (client.store.getFreeCapacity(RESOURCE_ENERGY)) {
                requests[client.id] = new Request(client)
            }
        }
    }

    for (const client of this.structures.tower) {
        if (client.store.getFreeCapacity(RESOURCE_ENERGY) > 400) {
            requests[client.id] = new Request(client)
        }
    }

    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY)) {
        requests[storage.id] = new Request(storage)
    }

    if (terminal && terminal.store.getFreeCapacity(RESOURCE_ENERGY) && terminal.store[RESOURCE_ENERGY] < (this.controller.level > 7 ? 60000 : 3000)) {
        requests[terminal.id] = new Request(terminal)
    }

    if (factory && factory.store.getFreeCapacity(RESOURCE_ENERGY) && factory.store.getUsedCapacity(RESOURCE_ENERGY) < 2000) {
        requests[factory.id] = new Request(factory)
    }

    if (this.laborersNeedDelivery) {
        for (const creep of this.creeps.laborer) {
            if (creep.store.getFreeCapacity(RESOURCE_ENERGY)) {
                requests[creep.id] = new Request(creep)
            }
        }
    }


    if (controllerContainer) {
        const amount = controllerContainer.store[RESOURCE_ENERGY]
        if (this.heap.refillControllerContainer && amount > 1900) {
            this.heap.refillControllerContainer = false
        } else if (!this.heap.refillControllerContainer && amount < 1000) {
            this.heap.refillControllerContainer = true
        }

        if (this.heap.refillControllerContainer) {
            requests[controllerContainer.id] = new Request(controllerContainer)
        }
    }

    this.heap.emptyControllerLink = false
    if (controllerLink && storageLink && controllerLink.store.getFreeCapacity(RESOURCE_ENERGY) > 400) {
        this.heap.emptyControllerLink = true
        if (storageLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            requests[storageLink.id] = new Request(storageLink)
        }
    }
    this.heap.storageUse = Object.keys(requests).length - numApplicants - 1

    return requests
}

Room.prototype.manageEnergySupply = function (arrayOfCreeps) {
    const requests = this.getEnergyRequests(arrayOfCreeps.length)
    if (!Object.keys(requests).length) {
        return
    }
    const applicants = []
    for (const creep of arrayOfCreeps) {
        if (creep.heap.engaged) {
            const client = Game.getObjectById(creep.heap.engaged.id)
            if (!client || client.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                delete creep.heap.engaged
                applicants.push(new Applicant(creep))
                continue
            }
            if (creep.giveEnergyTo(client.id) === OK) {
                delete creep.heap.engaged
            }
            if (requests[client.id]) {
                requests[client.id].amount -= creep.store.getUsedCapacity(RESOURCE_ENERGY)
            }
        } else {
            applicants.push(new Applicant(creep))
        }
    }

    const requestsArray = Object.values(requests)

    for (const request of requestsArray) {
        request.applicants = new Array(...applicants).sort((a, b) => a.pos.getRangeTo(request.pos) - b.pos.getRangeTo(request.pos))
    }

    while (true) {
        const freeRequests = requestsArray.filter(request => request.amount > 0 && request.applicants.length)
        if (!freeRequests.length) {
            break
        }
        for (const request of freeRequests) {
            const bestApplicant = request.applicants.shift()
            if (!bestApplicant.engaged) {
                request.amount -= bestApplicant.amount
                bestApplicant.engaged = request
                continue
            }
            const existingRequest = bestApplicant.engaged
            if (existingRequest.priority < request.priority) {
                continue
            }
            if (existingRequest.priority === request.priority && bestApplicant.pos.getRangeTo(existingRequest.pos) <= bestApplicant.pos.getRangeTo(request.pos)) {
                continue
            }
            request.amount -= bestApplicant.amount
            existingRequest.amount += bestApplicant.amount
            bestApplicant.engaged = request
        }
    }
    const isStorage = this.storage ? true : false
    const spawn = this.structures.spawn[0]
    for (const applicant of applicants) {
        const creep = applicant.creep
        if (applicant.engaged) {
            if (creep.giveEnergyTo(applicant.engaged.client.id) !== OK) {
                creep.heap.engaged = applicant.engaged
            }
            continue
        }
        if (isStorage) {
            continue
        }
        if (spawn) {
            creep.moveMy(spawn, { range: 3 })
        }
    }
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
    this.depot = depot
    this.pos = depot.pos
    this.priority = ENERGY_DEPOT_PRIORITY[depot.structureType] || (depot.destroyTime ? 2 : 1)
    this.amount = depot.amount || depot.store[RESOURCE_ENERGY]
}

Room.prototype.getEnergyDepots = function () {
    const energyDepots = {}
    const level = this.controller.level

    if (!this.memory.militaryThreat) {
        const tombstones = this.find(FIND_TOMBSTONES).filter(tombstone => tombstone.store[RESOURCE_ENERGY])
        for (const tombstone of tombstones) {
            energyDepots[tombstone.id] = new EnergyDepot(tombstone)
            energyDepots[tombstone.id].threshold = 50
        }

        const droppedResources = this.find(FIND_DROPPED_RESOURCES).filter(droppedResource => droppedResource.resourceType === RESOURCE_ENERGY && droppedResource.amount > 200)
        const filteredDroppedResources = droppedResources.filter(droppedResource => droppedResource.pos.getClosestRange(this.sources) > 1)
        for (const droppedResource of filteredDroppedResources) {
            energyDepots[droppedResource.id] = new EnergyDepot(droppedResource)
            energyDepots[droppedResource.id].threshold = 100
        }

        const ruins = this.find(FIND_RUINS).filter(ruin => ruin.store[RESOURCE_ENERGY] > 0)
        for (const ruin of ruins) {
            energyDepots[ruin.id] = new EnergyDepot(ruin)
            energyDepots[ruin.id].threshold = 50
        }

        for (const source of this.sources) {
            const droppedEnergies = source.droppedEnergies
            for (const droppedEnergy of droppedEnergies) {
                energyDepots[droppedEnergy.id] = new EnergyDepot(droppedEnergy)
                energyDepots[droppedEnergy.id].threshold = 100
                energyDepots[droppedEnergy.id].sourceId = source.id
            }

            const container = source.container
            if (container) {
                energyDepots[container.id] = new EnergyDepot(container)
                energyDepots[container.id].sourceId = source.id
            }
        }
    }


    if (this.terminal && this.terminal.store[RESOURCE_ENERGY] > (level === 8 ? 63000 : 5000)) {
        energyDepots[this.terminal.id] = new EnergyDepot(this.terminal)
    }

    if (this.storage) {
        if (this.heap.storageUse > 0) {
            energyDepots[this.storage.id] = new EnergyDepot(this.storage)
            energyDepots[this.storage.id].numUse = this.heap.storageUse
        }

        if (this.storage.link && this.storage.link.store.getUsedCapacity(RESOURCE_ENERGY) > 400 && !this.heap.emptyControllerLink) {
            energyDepots[this.storage.link.id] = new EnergyDepot(this.storage.link, 400)
        }
    }

    return energyDepots
}

Room.prototype.getSourceEnergyDepots = function (source) {
    const result = {}
    const droppedEnergies = source.droppedEnergies
    for (const droppedEnergy of droppedEnergies) {
        result[droppedEnergy.id] = new EnergyDepot(droppedEnergy, 100, true)
    }

    const container = source.container
    if (container) {
        result[container.id] = new EnergyDepot(container, 0, true)
    }

    return result
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
    for (const creep of arrayOfCreeps) {
        if (creep.heap.reserved) {
            const depot = Game.getObjectById(creep.heap.reserved.id)
            if (!depot || (!depot.amount && !(depot.store && depot.store[RESOURCE_ENERGY]))) {
                delete creep.heap.reserved
                applicants.push(new EnergyRequest(creep))
                continue
            }
            if (creep.getEnergyFrom(depot.id) === OK) {
                delete creep.heap.reserved
            }
            if (requests[depot.id]) {
                requests[depot.id].amount -= creep.store.getFreeCapacity()
                if (requests[depot.id].numUse !== undefined) {
                    requests[depot.id].numUse--
                }
            }
        } else {
            applicants.push(new EnergyRequest(creep))
        }
    }

    const requestsArray = Object.values(requests)

    const sourceApplicants = {}
    for (const source of this.sources) {
        sourceApplicants[source.id] = applicants.filter(applicant => applicant.creep.memory.sourceId === source.id)
    }

    for (const request of requestsArray) {
        if (request.sourceId !== undefined) {
            request.applicants = new Array(...sourceApplicants[request.sourceId]).sort((a, b) => a.pos.getRangeTo(request.pos) - b.pos.getRangeTo(request.pos))
            continue
        }
        request.applicants = new Array(...applicants).sort((a, b) => a.pos.getRangeTo(request.pos) - b.pos.getRangeTo(request.pos))
    }

    while (true) {
        const freeRequests = requestsArray.filter(request => (request.amount >= (request.threshold || 0) && request.applicants.length))
        if (!freeRequests.length) {
            break
        }
        for (const request of freeRequests) {
            const bestApplicant = request.applicants.shift()
            if (!request.threshold && bestApplicant.amount > request.amount) {
                continue
            }
            if (!bestApplicant.reserved) {
                request.amount -= bestApplicant.amount
                bestApplicant.reserved = request
                if (request.numUse !== undefined) {
                    request.numUse--
                }
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
            if (request.numUse !== undefined) {
                request.numUse--
            }
            existingRequest.amount += bestApplicant.amount
            if (existingRequest.numUse !== undefined) {
                existingRequest.numUse++
            }
            bestApplicant.reserved = request
        }
    }

    for (const applicant of applicants) {
        const creep = applicant.creep
        if (applicant.reserved) {
            if (creep.getEnergyFrom(applicant.reserved.depot.id) !== OK) {
                creep.heap.reserved = applicant.reserved
            }
            continue
        }

        if (creep.memory.role === 'manager') {
            if (this.storage) {
                creep.moveMy(this.storage, { range: 1 })
                continue
            }
        } else {
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
                const waitingPos = creep.pos.findClosestByRange(source.waitingArea.filter(pos => { return pos.walkable && creep.checkEmpty(pos) }))
                if (waitingPos) {
                    creep.heap.waitingPos = waitingPos
                    creep.moveMy(waitingPos)
                    continue
                }
            }
        }

    }
}

Room.prototype.manageEnergy = function () {
    let suppliers = []
    let fetchers = []
    const haulers = this.creeps.hauler.concat(this.creeps.manager)
    for (const creep of haulers) {
        if (creep.ticksToLive < 15) {
            creep.getRecycled()
            continue
        }
        if (creep.supplying) {
            suppliers.push(creep)
            continue
        }
        fetchers.push(creep)
    }

    this.manageEnergySupply(suppliers)
    this.manageEnergyFetch(fetchers)
}