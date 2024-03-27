const { config } = require('./config')

Room.prototype.factoryDistribution = function () {
  const factory = this.structures.factory[0]
  const terminal = this.terminal
  const researcher = this.creeps.researcher[0]

  const RAW_COMMODITIES_AMOUNT_TO_KEEP = 2000
  const BASIC_REGIONAL_COMMODITIES_AMOUNT_TO_KEEP = 100

  for (const resourceType of Object.keys(factory.store)) {
    if (
      RAW_RESOURCES.includes(resourceType) &&
      factory.store[resourceType] > RAW_COMMODITIES_AMOUNT_TO_KEEP * 1.1 &&
      terminal.store.getFreeCapacity() > 10000
    ) {
      if (!researcher) {
        this.heap.needResearcher = true
        return
      }
      return researcher.getDeliveryRequest(factory, terminal, resourceType)
    }

    if (
      Object.keys(BASIC_REGIONAL_COMMODITIES).includes(resourceType) &&
      factory.store[resourceType] >= BASIC_REGIONAL_COMMODITIES_AMOUNT_TO_KEEP &&
      terminal.store.getFreeCapacity() > 10000
    ) {
      if (!researcher) {
        this.heap.needResearcher = true
        return
      }
      return researcher.getDeliveryRequest(factory, terminal, resourceType)
    }
  }
}

Room.prototype.operateFactory = function () {
  const target = this.memory.factoryTarget

  if (!target) {
    return
  }

  const commodity = target.commodity
  const factory = this.structures.factory[0]
  const terminal = this.terminal

  const storage = this.storage

  const researcher = this.creeps.researcher[0]
  const components = getComponents(commodity)

  if (target.amount !== undefined && target.amount <= 0) {
    delete this.memory.factoryTarget //목표 바꿔야지
    return ERR_FULL
  }

  if (!components) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  if (factory.store.getFreeCapacity() < 1000) {
    const notNecessaryResource = Object.keys(factory.store).find(
      (resourceType) =>
        resourceType !== RESOURCE_ENERGY &&
        (!components[resourceType] || factory.store[resourceType] > components[resourceType] + 1000)
    )

    const targetStorage = [terminal, storage].find((structure) => structure && structure.store.getFreeCapacity() > 5000)

    if (notNecessaryResource && targetStorage) {
      if (!researcher) {
        this.heap.needResearcher = true
        return ERR_BUSY
      }
      researcher.getDeliveryRequest(factory, targetStorage, notNecessaryResource)
      return ERR_FULL
    }
  }

  const componentNames = Object.keys(components)

  for (const component of componentNames) {
    // check for components
    if (factory.store[component] < components[component]) {
      //재료가 없는 상황
      if (terminal && terminal.store[component] >= components[component] - factory.store[component]) {
        // get from terminal
        if (!researcher) {
          this.heap.needResearcher = true
          return ERR_BUSY
        }
        researcher.getDeliveryRequest(terminal, factory, component)
        return ERR_NOT_ENOUGH_RESOURCES
      } else if (storage && storage.store[component] >= components[component] - storage.store[component]) {
        //get from storage
        if (!researcher) {
          this.heap.needResearcher = true
          return ERR_BUSY
        }
        researcher.getDeliveryRequest(storage, factory, component)
        return ERR_NOT_ENOUGH_RESOURCES
      }
    }
  }

  const result = factory.produce(commodity)

  //자원 부족해지면
  if (result === ERR_NOT_ENOUGH_RESOURCES) {
    delete this.memory.factoryTarget //목표 바꿔야지
    return ERR_NOT_ENOUGH_RESOURCES
  }

  if (result === OK && this.memory.factoryTarget) {
    this.memory.factoryTarget.amount -= COMMODITIES[commodity].amount
  }

  return result
}

Room.prototype.getFactoryTarget = function () {
  if (this.memory.factoryTarget && this.memory.factoryTarget.amount > 0) {
    const cachedTarget = this.memory.factoryTarget.commodity
    if (this.checkCommodity(cachedTarget)) {
      return this.memory.factoryTarget
    }
  }

  // 방이 내 방이 아니면 오류
  if (!this.isMy) {
    return undefined
  }
  // RCL이 7보다 낮으면 오류
  if (this.controller.level < 7) {
    return undefined
  }

  // terminal 없으면 오류
  const terminal = this.terminal
  if (!terminal) {
    return undefined
  }

  // factory 없으면 오류
  const factory = this.structures.factory[0]
  if (!factory) {
    return undefined
  }

  if (this.memory.factoryTarget !== undefined) {
    return this.memory.factoryTarget
  }

  const targetCommodities = []

  for (const resourceType of config.factoryObjectives) {
    targetCommodities.push({ commodity: resourceType, amount: COMMODITIES[resourceType].amount })
  }

  if (this.getTotalFreeCapacity() < 100000) {
    const target = { commodity: RESOURCE_BATTERY, amount: 1000 }
    targetCommodities.push(target)
  } else if (this.getTotalFreeCapacity() > 200000) {
    const target = { commodity: RESOURCE_ENERGY, amount: 10000 }
    targetCommodities.push(target)
  }

  for (const mineral of BASIC_MINERALS) {
    if (terminal.store[mineral] >= 100000) {
      const components = COMMODITIES[mineral].components
      for (const component in components) {
        if (components[component] === 100) {
          const target = { commodity: component, amount: 2000 }
          targetCommodities.push(target)
        }
      }
    } else if (terminal.store[mineral] < 2000) {
      const target = { commodity: mineral, amount: 500 }
      targetCommodities.push(target)
    }
  }

  const checked = {}

  for (const target of targetCommodities) {
    const commodity = target.commodity
    const amount = target.amount

    // commodity 부터 확인하자
    const result = this.checkCommodity(commodity, checked)

    // 만들 수 있으면 만들자
    if (result === OK) {
      return (this.memory.factoryTarget = { commodity, amount })
    }

    // 아니면 queue에 넣고 BFS 시작
    const queue = [commodity]
    checked[commodity] = true

    // BFS
    while (queue.length > 0) {
      // queue에서 하나 빼옴
      const node = queue.shift()

      const components = getComponents(node)

      if (!components) {
        continue
      }

      // 각 component 확인
      for (const component in components) {
        // 이미 확인한 녀석이면 넘어가자
        if (checked[component]) {
          continue
        }

        const amount = components[component]

        // 충분히 있으면 넘어가자
        if (this.getResourceAmount(component) >= amount) {
          continue
        }

        // 확인 진행하자
        const result = this.checkCommodity(component, checked)

        // 만들 수 있으면 요놈을 만들자
        if (result === OK) {
          return (this.memory.factoryTarget = { commodity: component, amount })
        }

        // 둘 다 아니면 queue에 넣고 다음으로 넘어가자
        queue.push(component)
        checked[component] = true

        // 첫 번째 요소가 만들어지지 않으면 두 번째 요소를 만들진 않는다.
        break
      }

      // 만들만한 게 아무것도 없었으면 다음 target으로 넘어가자
    }
  }

  //만들 게 없음
  return (this.memory.factoryTarget = undefined)
}

function getComponents(resourceType) {
  if (!COMMODITIES[resourceType]) {
    return undefined
  }

  return COMMODITIES[resourceType].components
}

Room.prototype.checkCommodity = function (resourceType, checked) {
  const components = getComponents(resourceType)

  if (!components) {
    return ERR_INVALID_TARGET
  }

  for (const component in components) {
    // to avoid loop.(e.g. compress to make battery to decompress and make E)
    if (checked && checked[component]) {
      return ERR_INVALID_TARGET
    }

    if (this.getResourceAmount(component) >= components[component]) {
      continue
    }
    return ERR_NOT_ENOUGH_RESOURCES
  }

  return OK
}
