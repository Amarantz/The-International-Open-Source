import { RoomManager } from 'room/room'
import { findClosestObject, findObjectWithID, forAdjacentCoords, getRange, getRangeXY } from 'utils/utils'
import { myCreepUtils } from './myCreepUtils'
import { statsManager } from 'international/statsManager'
import {
  CreepMemoryKeys,
  CreepLogisticsRequestKeys,
  FlagNames,
  Result,
  RoomLogisticsRequestTypes,
  offsetsByDirection,
} from 'international/constants'
import { creepUtils } from './creepUtils'
import { communeUtils } from 'room/commune/communeUtils'
import {
  CreepLogisticsRequest,
  FindNewRoomLogisticsRequestArgs,
  RoomLogisticsRequest,
  RoomLogisticsTargets,
} from 'types/roomRequests'
import { customLog, stringifyLog } from 'utils/logging'
import { roomObjectUtils } from 'room/roomObjectUtils'
import { structureUtils } from 'room/structureUtils'
import { packCoord } from 'other/codec'

export class CreepProcs {
  advancedUpgradeController(creep: Creep) {
    const creepMemory = Memory.creeps[creep.name]
    const controller = creep.room.controller
    creepMemory[CreepMemoryKeys.targetID] = controller.id

    // Assign either the controllerLink or controllerContainer as the controllerStructure

    let controllerStructure: StructureLink | StructureContainer | false =
      creep.room.roomManager.controllerContainer
    const controllerLink = creep.room.communeManager.controllerLink

    if (!controllerStructure && controllerLink && structureUtils.isRCLActionable(controllerLink))
      controllerStructure = controllerLink

    // If there is a controllerContainer

    if (controllerStructure) {
      // If we're not on a viable upgrade pos

      const upgradePos = creepUtils.findUpgradePosWeak(creep)
      if (!upgradePos) {
        const upgradePos = creepUtils.findUpgradePosStrong(creep)
        if (!upgradePos) return false

        if (getRange(creep.pos, upgradePos) > 0) {
          creep.createMoveRequest({
            origin: creep.pos,
            goals: [
              {
                pos: upgradePos,
                range: 0,
              },
            ],
            avoidEnemyRanges: true,
            defaultCostMatrix(roomName) {
              const roomManager = RoomManager.roomManagers[roomName]
              if (!roomManager) return false

              return roomManager.defaultCostMatrix
            },
          })

          creep.message += '➡️'
        }
      }

      creep.actionCoord = creep.room.roomManager.centerUpgradePos

      const workPartCount = myCreepUtils.parts(creep).work
      const controllerRange = getRange(creep.pos, controller.pos)

      if (controllerRange <= 3 && creep.nextStore.energy > 0) {
        if (creep.upgradeController(controller) === OK) {
          creep.nextStore.energy -= workPartCount

          const controlPoints = workPartCount * UPGRADE_CONTROLLER_POWER

          statsManager.updateStat(creep.room.name, 'eou', controlPoints)
          creep.message += `🔋${controlPoints}`
        }
      }

      const controllerStructureRange = getRange(creep.pos, controllerStructure.pos)
      if (controllerStructureRange <= 3) {
        // If the controllerStructure is a container and is in need of repair

        if (
          controllerStructure.structureType === STRUCTURE_CONTAINER &&
          creep.nextStore.energy > 0 &&
          controllerStructure.hitsMax - controllerStructure.hits >= workPartCount * REPAIR_POWER
        ) {
          // If the repair worked

          if (creep.repair(controllerStructure) === OK) {
            // Find the repair amount by finding the smaller of the creep's work and the progress left for the cSite divided by repair power

            const energySpentOnRepairs = Math.min(
              workPartCount,
              (controllerStructure.hitsMax - controllerStructure.hits) / REPAIR_POWER,
              creep.nextStore.energy,
            )

            creep.nextStore.energy -= energySpentOnRepairs

            // Add control points to total controlPoints counter and say the success

            statsManager.updateStat(creep.room.name, 'eoro', energySpentOnRepairs)
            creep.message += `🔧${energySpentOnRepairs * REPAIR_POWER}`
          }
        }

        if (controllerStructureRange <= 1 && creep.nextStore.energy <= 0) {
          // Withdraw from the controllerContainer, informing false if the withdraw failed

          if (creep.withdraw(controllerStructure, RESOURCE_ENERGY) !== OK) return false

          creep.nextStore.energy += Math.min(
            creep.store.getCapacity(),
            controllerStructure.nextStore.energy,
          )
          controllerStructure.nextStore.energy -= creep.nextStore.energy

          delete creepMemory[CreepMemoryKeys.targetID]
          creep.message += `⚡`
        }
      }

      return true
    }

    // If the creep needs resources

    if (creep.needsResources()) {
      creepProcs.runRoomLogisticsRequestsAdvanced(creep, {
        types: new Set<RoomLogisticsRequestTypes>([
          RoomLogisticsRequestTypes.withdraw,
          RoomLogisticsRequestTypes.pickup,
          RoomLogisticsRequestTypes.offer,
        ]),
        conditions: request => request.resourceType === RESOURCE_ENERGY,
      })

      if (creep.needsResources()) return false

      delete creepMemory[CreepMemoryKeys.targetID]

      creep.createMoveRequest({
        origin: creep.pos,
        goals: [{ pos: controller.pos, range: 3 }],
        avoidEnemyRanges: true,
        defaultCostMatrix(roomName) {
          const roomManager = RoomManager.roomManagers[roomName]
          if (!roomManager) return false

          return roomManager.defaultCostMatrix
        },
      })
      return false
    }

    // Otherwise if the creep doesn't need resources

    // If the controller is out of upgrade range

    creep.actionCoord = controller.pos

    if (getRange(creep.pos, controller.pos) > 3) {
      // Make a move request to it

      creep.createMoveRequest({
        origin: creep.pos,
        goals: [{ pos: controller.pos, range: 3 }],
        avoidEnemyRanges: true,
        defaultCostMatrix(roomName) {
          const roomManager = RoomManager.roomManagers[roomName]
          if (!roomManager) return false

          return roomManager.defaultCostMatrix
        },
      })

      // Inform false

      return false
    }

    // Try to upgrade the controller, and if it worked

    if (creep.upgradeController(controller) === OK) {
      // Add control points to total controlPoints counter and say the success

      const energySpentOnUpgrades = Math.min(
        creep.nextStore.energy,
        myCreepUtils.parts(creep).work * UPGRADE_CONTROLLER_POWER,
      )

      statsManager.updateStat(creep.room.name, 'eou', energySpentOnUpgrades)
      creep.message = `🔋${energySpentOnUpgrades}`

      // Inform true

      return true
    }

    // Inform false

    return false
  }
  /**
   * Overhead logic ran for dead creeps
   */
  runDead(creepName: string) {
    const creepMemory = Memory.creeps[creepName]
    const role = creepUtils.roleName(creepName)
  }
  runRepair(creep: Creep, target: Structure) {
    // If we've already schedhuled a work intent, don't try to do another
    if (creep.worked) return Result.noAction
    if (creep.repair(target) !== OK) return Result.fail

    const workParts = myCreepUtils.parts(creep).work
    // Estimate the repair cost, assuming it goes through
    const energySpentOnRepair = Math.min(
      workParts,
      // Sometimes hitsMax can be more than hits
      Math.max((target.hitsMax - target.hits) / REPAIR_POWER, 0),
      creep.store.energy,
    )

    // Record the repair attempt in different places for barricades than other structures
    if (target.structureType === STRUCTURE_RAMPART || target.structureType === STRUCTURE_WALL) {
      statsManager.updateStat(creep.room.name, 'eorwr', energySpentOnRepair)
      creep.message = `🧱${energySpentOnRepair * REPAIR_POWER}`
    } else {
      statsManager.updateStat(creep.room.name, 'eoro', energySpentOnRepair)
      creep.message = `🔧${energySpentOnRepair * REPAIR_POWER}`
    }

    // Estimate the target's nextHits so we can target creeps accordingly
    target.nextHits = Math.min(target.nextHits + workParts * REPAIR_POWER, target.hitsMax)
    return Result.success
  }
  repairCommune(creep: Creep) {
    if (creep.needsResources()) {
      if (
        creep.room.communeManager.storingStructures.length &&
        creep.room.roomManager.resourcesInStoringStructures.energy < 3000
      )
        return Result.fail

      // Reset target so when we are full we search again
      delete Memory.creeps[creep.name][CreepMemoryKeys.structureTarget]

      creepProcs.runRoomLogisticsRequestsAdvanced(creep, {
        types: new Set<RoomLogisticsRequestTypes>([
          RoomLogisticsRequestTypes.withdraw,
          RoomLogisticsRequestTypes.offer,
          RoomLogisticsRequestTypes.pickup,
        ]),
        resourceTypes: new Set([RESOURCE_ENERGY]),
      })

      if (creep.needsResources()) return false
    }

    // Otherwise if we don't need resources and can maintain

    const workPartCount = myCreepUtils.parts(creep).work
    let repairTarget = creepUtils.findRepairTarget(creep)

    if (!repairTarget) {
      creep.message = '❌🔧'
      return false
    }

    creep.message = '⏩🔧'
    creep.room.targetVisual(creep.pos, repairTarget.pos)

    creep.actionCoord = repairTarget.pos

    // Move to target if out of range

    if (getRange(creep.pos, repairTarget.pos) > 3) {
      creep.createMoveRequest({
        origin: creep.pos,
        goals: [{ pos: repairTarget.pos, range: 3 }],
        avoidEnemyRanges: true,
        defaultCostMatrix(roomName) {
          const roomManager = RoomManager.roomManagers[roomName]
          if (!roomManager) return false

          return roomManager.defaultCostMatrix
        },
      })

      return false
    }

    if (this.runRepair(creep, repairTarget) !== Result.success) return Result.fail

    // If the structure is a rampart, continue repairing it

    if (repairTarget.structureType === STRUCTURE_RAMPART) return true
    // Otherwise if it isn't a rampart and it will be viable to repair next tick
    else if (repairTarget.hitsMax - repairTarget.nextHits >= workPartCount * REPAIR_POWER) {
      return true
    }

    // Otherwise we need a new target
    delete Memory.creeps[creep.name][CreepMemoryKeys.structureTarget]
    delete creep.actionCoord

    // We already repaired so we can only move to a target, so if we've already done that, it's not worth continueing
    if (creep.moved) return true

    // Find repair targets that don't include the current target, informing true if none were found

    repairTarget = creepUtils.findNewRepairTarget(creep) || creepUtils.findNewRampartRepairTarget(creep)
    if (!repairTarget) return true

    creep.actionCoord = repairTarget.pos

    // We are already in repair range, no need to move closer
    if (getRange(creep.pos, repairTarget.pos) <= 3) return true

    // Make a move request to it

    creep.createMoveRequest({
      origin: creep.pos,
      goals: [{ pos: repairTarget.pos, range: 3 }],
      avoidEnemyRanges: true,
      defaultCostMatrix(roomName) {
        const roomManager = RoomManager.roomManagers[roomName]
        if (!roomManager) return false

        return roomManager.defaultCostMatrix
      },
    })

    return true
  }
  repairCommuneStationary(creep: Creep) {}
  repairNearby(creep: Creep) {
    // If the this has no energy, inform false

    if (creep.nextStore.energy <= 0) return Result.noAction

    creep.message += '🗺️'

    const workPartCount = myCreepUtils.parts(creep).work
    // At some point we should compare this search with flat searching positions around the creep
    const structure = communeUtils.getGeneralRepairStructures(creep.room).find(structure => {
      return (
        getRange(structure.pos, creep.pos) <= 3 &&
        structure.hitsMax - structure.hits >= workPartCount * REPAIR_POWER
      )
    })
    if (!structure) return Result.noAction

    if (this.runRepair(creep, structure) !== Result.success) return Result.fail

    // Otherwise we repaired successfully

    return Result.success
  }
  updateLogisticsRequests(creep: Creep) {
    const creepMemory = Memory.creeps[creep.name]
    if (!creepMemory[CreepMemoryKeys.roomLogisticsRequests]) {
      creepMemory[CreepMemoryKeys.roomLogisticsRequests] = []
      return
    }
    if (!creepMemory[CreepMemoryKeys.roomLogisticsRequests].length) return
    /*
    for (let i = creepMemory[CreepMemoryKeys.roomLogisticsRequests].length - 1; i >= 0; i--) {
      const request = creepMemory[CreepMemoryKeys.roomLogisticsRequests][i]
      const target = findObjectWithID(request[CreepRoomLogisticsRequestKeys.target])
      if (target) continue

      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(i, 1)
    }
 */
    const request = creepMemory[CreepMemoryKeys.roomLogisticsRequests][0]
    if (!request) return

    const target = findObjectWithID(request[CreepLogisticsRequestKeys.target])
    if (!target) {
      if (Game.flags[FlagNames.debugCreepLogistics]) {
        creep.room.visual.text('❌T', creep.pos)
      }

      if (request[CreepLogisticsRequestKeys.delivery]) {
        creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 2)
        return
      }

      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return
    }

    // requests where they are delivering
    if (request[CreepLogisticsRequestKeys.delivery]) {
      this.updateDeliverLogisticsRequest(
        creep,
        request,
        creepMemory[CreepMemoryKeys.roomLogisticsRequests][1],
        target,
      )
      return
    }

    // If pickup type
    if (target instanceof Resource) {
      this.updatePickupLogisticsRequest(creep, request, target)
      return
    }

    // transfer requests
    if (request[CreepLogisticsRequestKeys.type] === RoomLogisticsRequestTypes.transfer) {
      this.updateTransferLogisticsRequest(creep, request, target)
      return
    }

    // Withdraw or offer type
    this.updateWithdrawLogisticsRequest(creep, request, target)
    return
  }

  /**
   *
   * @returns false if the request was deleted
   */
  private updateTransferLogisticsRequest(
    creep: Creep,
    request: CreepLogisticsRequest,
    target: RoomObject & { store: StoreDefinition },
  ) {
    const creepMemory = Memory.creeps[creep.name]

    // Delete the request if the target is fulfilled

    const targetFreeNextStore = roomObjectUtils.freeNextStoreOf(
      target,
      request[CreepLogisticsRequestKeys.resourceType],
    )
    if (targetFreeNextStore < request[CreepLogisticsRequestKeys.amount]) {
      if (Game.flags[FlagNames.debugCreepLogistics]) {
        creep.room.visual.text(
          '❌TA1 ' + targetFreeNextStore + '/' + request[CreepLogisticsRequestKeys.amount],
          creep.pos,
          { font: 0.2 },
        )
        customLog(
          'not enough free store',
          creep.name +
            ', ' +
            request[CreepLogisticsRequestKeys.target] +
            ', ' +
            targetFreeNextStore +
            ' < ' +
            request[CreepLogisticsRequestKeys.amount],
        )
      }

      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return false
    }

    request[CreepLogisticsRequestKeys.amount] = Math.min(
      Math.min(
        creep.nextStore[request[CreepLogisticsRequestKeys.resourceType]],
        targetFreeNextStore,
      ),
      request[CreepLogisticsRequestKeys.amount],
    )
    if (request[CreepLogisticsRequestKeys.amount] <= 0) {
      if (Game.flags[FlagNames.debugCreepLogistics]) {
        creep.room.visual.text(
          '❌TA2 ' +
            targetFreeNextStore +
            ' ' +
            creep.nextStore[request[CreepLogisticsRequestKeys.resourceType]],
          creep.pos,
          { font: 0.2 },
        )
        customLog(
          'not enough amount',
          creep.name +
            ', ' +
            request[CreepLogisticsRequestKeys.target] +
            ', ' +
            request[CreepLogisticsRequestKeys.amount],
        )
      }

      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return false
    }

    if (!request[CreepLogisticsRequestKeys.noReserve]) {
      target.reserveStore[request[CreepLogisticsRequestKeys.resourceType]] +=
        request[CreepLogisticsRequestKeys.amount]
    }

    return true
  }

  /**
   *
   * @returns false if the request was deleted
   */
  private updatePickupLogisticsRequest(
    creep: Creep,
    request: CreepLogisticsRequest,
    target: Resource,
  ) {
    const creepMemory = Memory.creeps[creep.name]
    const creepFreeNextStore = roomObjectUtils.freeNextStoreOf(
      creep,
      request[CreepLogisticsRequestKeys.resourceType],
    )

    // Update in accordance to potential resource decay

    request[CreepLogisticsRequestKeys.amount] = Math.min(
      Math.min(creepFreeNextStore, target.nextAmount),
      request[CreepLogisticsRequestKeys.amount],
    )
    if (request[CreepLogisticsRequestKeys.amount] <= 0) {
      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return false
    }

    if (!request[CreepLogisticsRequestKeys.noReserve]) {
      target.reserveAmount -= request[CreepLogisticsRequestKeys.amount]
    }

    return true
  }

  /**
   *
   * @returns false if the request was deleted
   */
  private updateWithdrawLogisticsRequest(
    creep: Creep,
    request: CreepLogisticsRequest,
    target: RoomLogisticsTargets,
  ) {
    const creepMemory = Memory.creeps[creep.name]

    // Delete the request if the target doesn't have what we need
    if (
      target.nextStore[request[CreepLogisticsRequestKeys.resourceType]] <
      request[CreepLogisticsRequestKeys.amount]
    ) {
      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return false
    }

    const creepFreeNextStore = roomObjectUtils.freeNextStoreOf(
      creep,
      request[CreepLogisticsRequestKeys.resourceType],
    )
    request[CreepLogisticsRequestKeys.amount] = Math.min(
      Math.min(
        creepFreeNextStore,
        target.nextStore[request[CreepLogisticsRequestKeys.resourceType]],
      ),
      request[CreepLogisticsRequestKeys.amount],
    )
    if (request[CreepLogisticsRequestKeys.amount] <= 0) {
      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return false
    }

    if (!request[CreepLogisticsRequestKeys.noReserve]) {
      target.reserveStore[request[CreepLogisticsRequestKeys.resourceType]] -=
        request[CreepLogisticsRequestKeys.amount]
    }

    return true
  }

  /**
   * update both request pairs of the deliver request
   * @param creep
   * @param request pickup, withdraw or offer to get sufficient resources
   * @param deliverToRequest transfer to delivery target
   */
  private updateDeliverLogisticsRequest(
    creep: Creep,
    request: CreepLogisticsRequest,
    deliverToRequest: CreepLogisticsRequest,
    target: RoomLogisticsTargets,
  ) {
    const creepMemory = Memory.creeps[creep.name]

    const deliverTarget = findObjectWithID(deliverToRequest[CreepLogisticsRequestKeys.target])
    if (!deliverTarget) {
      if (Game.flags[FlagNames.debugCreepLogistics]) {
        creep.room.visual.text('❌DT', creep.pos)
      }

      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 2)
      return false
    }

    // If pickup type
    if (target instanceof Resource) {
      // Update in accordance to potential resource decay

      const creepFreeNextStore = roomObjectUtils.freeNextStoreOf(
        creep,
        request[CreepLogisticsRequestKeys.resourceType],
      )
      request[CreepLogisticsRequestKeys.amount] = Math.min(
        Math.min(creepFreeNextStore, target.nextAmount),
        request[CreepLogisticsRequestKeys.amount],
      )
      if (request[CreepLogisticsRequestKeys.amount] <= 0) {
        if (Game.flags[FlagNames.debugCreepLogistics]) {
          creep.room.visual.text('❌DT0R', creep.pos)
        }
        creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 2)
        return false
      }

      if (!request[CreepLogisticsRequestKeys.noReserve]) {
        target.reserveAmount -= request[CreepLogisticsRequestKeys.amount]
        deliverTarget.reserveStore[request[CreepLogisticsRequestKeys.resourceType]] += Math.min(
          deliverToRequest[CreepLogisticsRequestKeys.amount],
          request[CreepLogisticsRequestKeys.amount],
        )
      }

      return true
    }

    // Withdraw or offer

    // Delete the request if the target doesn't have what we need
    if (
      target.nextStore[request[CreepLogisticsRequestKeys.resourceType]] <
      request[CreepLogisticsRequestKeys.amount]
    ) {
      if (Game.flags[FlagNames.debugCreepLogistics]) {
        creep.room.visual.text('❌DTA', creep.pos)
      }

      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 2)
      return false
    }

    const creepFreeNextStore = roomObjectUtils.freeNextStoreOf(
      creep,
      request[CreepLogisticsRequestKeys.resourceType],
    )
    request[CreepLogisticsRequestKeys.amount] = Math.min(
      Math.min(
        creepFreeNextStore,
        target.nextStore[request[CreepLogisticsRequestKeys.resourceType]],
      ),
      request[CreepLogisticsRequestKeys.amount],
    )
    if (request[CreepLogisticsRequestKeys.amount] <= 0) {
      if (Game.flags[FlagNames.debugCreepLogistics]) {
        creep.room.visual.text('❌DT0A', creep.pos)
      }
      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 2)
      return false
    }

    if (!request[CreepLogisticsRequestKeys.noReserve]) {
      target.reserveStore[request[CreepLogisticsRequestKeys.resourceType]] -=
        request[CreepLogisticsRequestKeys.amount]
      deliverTarget.reserveStore[request[CreepLogisticsRequestKeys.resourceType]] += Math.min(
        deliverToRequest[CreepLogisticsRequestKeys.amount],
        request[CreepLogisticsRequestKeys.amount],
      )
    }

    return true
  }

  registerSpawning(creep: Creep, spawn: StructureSpawn) {
    if (spawn.spawning.remainingTime > 1 || spawn.spawning.name.includes('shard')) return

    const offset = offsetsByDirection[spawn.spawning.directions[0]]
    const coord = {
      x: creep.pos.x + offset[0],
      y: creep.pos.y + offset[1],
    }

    creep.assignMoveRequest(coord)
  }

  runRoomLogisticsRequestAdvanced(creep: Creep, args?: FindNewRoomLogisticsRequestArgs) {
    const request = creepUtils.findRoomLogisticsRequest(creep, args)
    if (!request) return Result.noAction

    /* log('REQUEST RESPONSE', request.T, { position: 1 }) */
    const target = findObjectWithID(request[CreepLogisticsRequestKeys.target])
    if (Game.flags[FlagNames.debugCreepLogistics])
      creep.room.targetVisual(creep.pos, target.pos, true)
    if (getRange(target.pos, creep.pos) > 1) {
      const result = creep.createMoveRequest({
        origin: creep.pos,
        goals: [{ pos: target.pos, range: 1 }],
        defaultCostMatrix(roomName) {
          const roomManager = RoomManager.roomManagers[roomName]
          if (!roomManager) return false

          return roomManager.defaultCostMatrix
        },
      })
      // An enemy is probably blocking access to the logistics target
      if (result === Result.fail) {
        creep.room.roomManager.roomLogisticsBlacklistCoords.add(packCoord(target.pos))
        Result.fail
      }

      return Result.action
    }

    // If we already moved a resource creep tick, then wait (presumably) until the next one to take any resoure-moving action
    if (creep.movedResource) {
      if (Game.flags[FlagNames.debugCreepLogistics]) {
        creep.room.visual.text('MR', creep.pos)
      }

      return Result.noAction
    }

    if (Game.flags[FlagNames.debugCreepLogistics]) {
      creep.room.visual.text(request[CreepLogisticsRequestKeys.amount].toString(), creep.pos)
    }

    /*     log(
          'DOING REQUEST',
          request.T + ', ' + request[CreepRoomLogisticsRequestKeys.amount] + ', ' + creep.store.getCapacity(request[CreepRoomLogisticsRequestKeys.resourceType]) + ', ' + creep.name,
          { position: 1 },
      ) */
    // Pickup type

    if (target instanceof Resource) {
      creep.pickup(target)
      creep.movedResource = true

      creep.nextStore[request[CreepLogisticsRequestKeys.resourceType]] +=
        request[CreepLogisticsRequestKeys.amount]
      target.nextAmount -= request[CreepLogisticsRequestKeys.amount]

      creep.memory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return Result.success
    }

    if (request[CreepLogisticsRequestKeys.type] === RoomLogisticsRequestTypes.transfer) {
      /* stringifyLog('tried to resolve request for ' + creep.name, request) */

      const result = creep.transfer(
        target as AnyStoreStructure | Creep,
        request[CreepLogisticsRequestKeys.resourceType],
        request[CreepLogisticsRequestKeys.amount],
      )
      if (result !== OK) {
        creep.room.visual.text(result.toString(), creep.pos)
        return Result.fail
      }

      creep.movedResource = true

      creep.nextStore[request[CreepLogisticsRequestKeys.resourceType]] -=
        request[CreepLogisticsRequestKeys.amount]
      target.nextStore[request[CreepLogisticsRequestKeys.resourceType]] +=
        request[CreepLogisticsRequestKeys.amount]

      creep.memory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return Result.success
    }

    // Withdraw or offer type

    // Creeps need to transfer to each other

    if (target instanceof Creep) {
      if (
        target.transfer(
          creep,
          request[CreepLogisticsRequestKeys.resourceType],
          request[CreepLogisticsRequestKeys.amount],
        ) !== OK
      )
        return Result.fail

      target.movedResource = true

      creep.nextStore[request[CreepLogisticsRequestKeys.resourceType]] +=
        request[CreepLogisticsRequestKeys.amount]
      target.nextStore[request[CreepLogisticsRequestKeys.resourceType]] -=
        request[CreepLogisticsRequestKeys.amount]

      creep.memory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return Result.action
    }

    if (
      creep.withdraw(
        target,
        request[CreepLogisticsRequestKeys.resourceType],
        request[CreepLogisticsRequestKeys.amount],
      ) !== OK
    )
      return Result.fail

    creep.movedResource = true

    creep.nextStore[request[CreepLogisticsRequestKeys.resourceType]] +=
      request[CreepLogisticsRequestKeys.amount]
    target.nextStore[request[CreepLogisticsRequestKeys.resourceType]] -=
      request[CreepLogisticsRequestKeys.amount]

    creep.memory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
    return Result.success
  }

  runRoomLogisticsRequestsAdvanced(creep: Creep, args?: FindNewRoomLogisticsRequestArgs) {
    if (creep.spawning) return Result.noAction

    const result = creepProcs.runRoomLogisticsRequestAdvanced(creep, args)
    if (result === Result.action) return result

    creepProcs.runRoomLogisticsRequestAdvanced(creep, args)
    return Result.success
  }

  runRoomLogisticsRequest(creep: Creep) {
    const creepMemory = Memory.creeps[creep.name]
    const request = creepMemory[CreepMemoryKeys.roomLogisticsRequests][0]
    if (!request) return Result.fail

    /* log('REQUEST RESPONSE', request.T, { position: 1 }) */
    const target = findObjectWithID(request[CreepLogisticsRequestKeys.target])

    if (getRange(target.pos, creep.pos) > 1) {
      creep.createMoveRequest({
        origin: creep.pos,
        goals: [{ pos: target.pos, range: 1 }],
        defaultCostMatrix(roomName) {
          const roomManager = RoomManager.roomManagers[roomName]
          if (!roomManager) return false

          return roomManager.defaultCostMatrix
        },
      })

      return Result.action
    }

    // If we already moved a resource creep tick, then wait (presumably) until the next one to take any resoure-moving action
    if (creep.movedResource) return Result.noAction

    /*     log(
          'DOING REQUEST',
          request.T + ', ' + request[CreepRoomLogisticsRequestKeys.amount] + ', ' + creep.store.getCapacity(request[CreepRoomLogisticsRequestKeys.resourceType]) + ', ' + creep.name,
          { position: 1 },
      ) */
    // Pickup type

    if (target instanceof Resource) {
      creep.pickup(target)
      creep.movedResource = true

      creep.nextStore[request[CreepLogisticsRequestKeys.resourceType]] +=
        request[CreepLogisticsRequestKeys.amount]
      target.nextAmount -= request[CreepLogisticsRequestKeys.amount]

      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return Result.success
    }

    if (request[CreepLogisticsRequestKeys.type] === RoomLogisticsRequestTypes.transfer) {
      if (
        creep.transfer(
          target as AnyStoreStructure | Creep,
          request[CreepLogisticsRequestKeys.resourceType],
          request[CreepLogisticsRequestKeys.amount],
        ) !== OK
      )
        return Result.fail

      creep.movedResource = true

      creep.nextStore[request[CreepLogisticsRequestKeys.resourceType]] -=
        request[CreepLogisticsRequestKeys.amount]
      target.nextStore[request[CreepLogisticsRequestKeys.resourceType]] +=
        request[CreepLogisticsRequestKeys.amount]

      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return Result.success
    }

    // Withdraw or offer type

    // Creeps need to transfer to each other

    if (target instanceof Creep) {
      if (
        target.transfer(
          creep,
          request[CreepLogisticsRequestKeys.resourceType],
          request[CreepLogisticsRequestKeys.amount],
        ) !== OK
      )
        return Result.fail

      creep.movedResource = true

      creep.nextStore[request[CreepLogisticsRequestKeys.resourceType]] +=
        request[CreepLogisticsRequestKeys.amount]
      target.nextStore[request[CreepLogisticsRequestKeys.resourceType]] -=
        request[CreepLogisticsRequestKeys.amount]

      creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
      return Result.success
    }

    if (
      creep.withdraw(
        target,
        request[CreepLogisticsRequestKeys.resourceType],
        request[CreepLogisticsRequestKeys.amount],
      ) !== OK
    )
      return Result.fail

    creep.movedResource = true

    creep.nextStore[request[CreepLogisticsRequestKeys.resourceType]] +=
      request[CreepLogisticsRequestKeys.amount]
    target.nextStore[request[CreepLogisticsRequestKeys.resourceType]] -=
      request[CreepLogisticsRequestKeys.amount]

    creepMemory[CreepMemoryKeys.roomLogisticsRequests].splice(0, 1)
    return Result.success
  }

  runRoomLogisticsRequests(creep: Creep) {
    if (creep.spawning) return false

    if (this.runRoomLogisticsRequest(creep) !== Result.success) return false

    this.runRoomLogisticsRequest(creep)
    return true
  }

  findCreepRoomLogisticsRequestAmount(
    creep: Creep,
    type: RoomLogisticsRequestTypes,
    targetID: Id<RoomLogisticsTargets>,
    amount: number,
    resourceType: ResourceConstant,
  ) {
    const target = findObjectWithID(targetID)

    // Pickup type

    if (target instanceof Resource) {
      // Update in accordance to potential resource decay

      amount = Math.min(target.nextAmount, amount)
      if (amount <= 0) return amount

      target.reserveAmount -= amount
      return amount
    }

    if (type === RoomLogisticsRequestTypes.transfer) {
      // Delete the request if the target is fulfilled

      const targetFreeReserveStore = roomObjectUtils.freeNextStoreOf(target, resourceType)
      if (targetFreeReserveStore < amount) return 0

      amount = Math.min(Math.min(creep.nextStore[resourceType], targetFreeReserveStore), amount)
      if (amount <= 0) return amount

      target.reserveStore[resourceType] += amount
      return amount
    }

    // Withdraw or offer type

    // Delete the request if the target doesn't have what we need

    if (target.nextStore[resourceType] < amount) return amount

    amount = Math.min(target.nextStore[resourceType], amount)
    if (amount <= 0) return amount

    target.reserveStore[resourceType] -= amount
    return amount
  }

  createCreepRoomLogisticsRequest(
    creep: Creep,
    type: RoomLogisticsRequestTypes,
    targetID: Id<RoomLogisticsTargets>,
    amount: number,
    resourceType: ResourceConstant = RESOURCE_ENERGY,
  ) {
    /* amount = */ this.findCreepRoomLogisticsRequestAmount(creep, type, targetID, amount, resourceType)
    if (amount <= 0) return Result.fail

    creep.memory[CreepMemoryKeys.roomLogisticsRequests].push({
      [CreepLogisticsRequestKeys.type]: type,
      [CreepLogisticsRequestKeys.target]: targetID,
      [CreepLogisticsRequestKeys.resourceType]: resourceType,
      [CreepLogisticsRequestKeys.amount]: amount,
    })

    return Result.success
  }

  activeRenew(creep: Creep) {
    const { room } = creep

    // If there is insufficient CPU to renew, inform false

    if (!room.myCreepsByRole.fastFiller.length) return
    if (creep.isDying()) return

    // If the creep's age is less than the benefit from renewing, inform false

    const creepCost = Memory.creeps[creep.name][CreepMemoryKeys.cost]
    const energyCost = Math.ceil(creepCost / 2.5 / creep.body.length)
    if (CREEP_LIFE_TIME - creep.ticksToLive < Math.floor(600 / creep.body.length)) return

    const spawns = room.roomManager.structures.spawn.filter(
      spawn => !spawn.renewed && !spawn.spawning,
    )
    if (!spawns.length) return

    const spawn = findClosestObject(creep.pos, spawns)

    if (getRange(creep.pos, spawn.pos) > 1) {
      creep.createMoveRequest({
        origin: creep.pos,
        goals: [{ pos: spawn.pos, range: 1 }],
        avoidEnemyRanges: true,
      })
      return
    }

    const result = spawn.renewCreep(creep)
    if (result === OK) {
      statsManager.updateStat(creep.room.name, 'eosp', energyCost)
      spawn.renewed = true
    }
  }

  passiveRenew(creep: Creep) {
    const { room } = creep

    // If there is insufficient CPU to renew, inform false

    if (creep.body.length > 10) return
    if (!room.myCreepsByRole.fastFiller.length) return
    if (creep.isDying()) return

    // If the creep's age is less than the benefit from renewing, inform false

    const creepCost = Memory.creeps[creep.name][CreepMemoryKeys.cost]
    const energyCost = Math.ceil(creepCost / 2.5 / creep.body.length)
    if (CREEP_LIFE_TIME - creep.ticksToLive < Math.floor(600 / creep.body.length)) return

    // Get the room's spawns, stopping if there are none

    const spawns = room.roomManager.structures.spawn

    // Get a spawn in range of 1, informing false if there are none

    const spawn = spawns.find(
      spawn =>
        getRangeXY(creep.pos.x, spawn.pos.x, creep.pos.y, spawn.pos.y) === 1 &&
        !spawn.renewed &&
        !spawn.spawning &&
        structureUtils.isRCLActionable(spawn),
    )
    if (!spawn) return

    const result = spawn.renewCreep(creep)
    if (result === OK) {
      statsManager.updateStat(creep.room.name, 'eosp', energyCost)
      spawn.renewed = true
    }
  }

}

export const creepProcs = new CreepProcs()