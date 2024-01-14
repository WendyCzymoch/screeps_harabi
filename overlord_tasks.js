const METHODS_BY_CATEGORY = {
  powerBank: `managePowerBankTasks`,
  deposit: 'manageDepositTasks',
  guard: 'manageGuardTasks',
  quad: 'manageQuadTasks',
  duo: `manageDuoTasks`,
  siege: 'manageSiegeTasks'
}

Object.defineProperties(Overlord, {
  tasks: {
    get() {
      if (Memory.tasks) {
        return Memory.tasks
      }
      return Memory.tasks = {}
    }
  }
})

Overlord.getTasksByRoomInCharge = function (roomName) {
  const result = {}

  for (const category in Overlord.tasks) {
    result[category] = result[category] || {}
    const tasks = Overlord.tasks[category]
    for (const task of Object.values(tasks)) {
      if (task.roomNameInCharge !== roomName) {
        continue
      }
      result[category][task.id] = task
    }
  }

  return result
}

Overlord.getTaskCategories = function () {
  return Object.keys(Overlord.tasks)
}

Overlord.getTasksWithCategory = function (category) {
  Overlord.tasks[category] = Overlord.tasks[category] || {}
  return Overlord.tasks[category]
}

Overlord.registerTask = function (task) {
  const category = task.category
  if (!category) {
    console.log(`no category for ${JSON.stringify(task)}`)
    return
  }
  const tasks = this.getTasksWithCategory(category)
  tasks[task.id] = task
}

Overlord.deleteTask = function (task) {
  const category = task.category
  const tasks = this.getTasksWithCategory(category)
  delete tasks[task.id]
  return
}

Overlord.runTasks = function () {
  const categories = this.getTaskCategories()
  for (const category of categories) {
    const functionName = METHODS_BY_CATEGORY[category]
    Overlord[functionName]()
  }
}