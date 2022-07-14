import { communeSigns, nonCommuneSigns } from 'international/constants'
import { findClosestCommuneName } from 'international/generalFunctions'
import { creepClasses, Scout } from '../../creepClasses'

export function scoutManager(room: Room, creepsOfRole: string[]) {
    // Loop through the names of the creeps of the role

    for (const creepName of creepsOfRole) {
        // Get the creep using its name

        const creep: Scout = Game.creeps[creepName]

        const commune = Game.rooms[creep.memory.commune]

        if (!commune) continue

        // If there is no scoutTarget, find one

        if (!creep.findScoutTarget()) continue

        // If the room hasn't been scouted for some time, scout it

        if (Game.time - 100 >= room.memory.lastScout) {
            creep.say('👁️')

            // Get information about the room

            room.findType(commune)

            // Clean the room's memory

            room.cleanMemory()
        }

        // Say the scoutTarget

        creep.say(`🔭${creep.memory.scoutTarget.toString()}`)

        // If there is a controller, sign the controller. If the creep signed it

        if (creep.advancedSignController() && creep.memory.scoutTarget === room.name) {
            // Change scoutTarget

            delete creep.memory.scoutTarget

            if (!creep.findScoutTarget()) continue

            // Say the scoutTarget

            creep.say(`🔭x${creep.memory.scoutTarget.toString()}`)
        }

        if (creep.moveRequest) continue

        // Try to go to the scoutTarget

        creep.createMoveRequest({
            origin: creep.pos,
            goal: {
                pos: new RoomPosition(25, 25, creep.memory.scoutTarget),
                range: 25,
            },
            avoidEnemyRanges: true,
            plainCost: 1,
            swampCost: 1,
        })

        // If the creep can't get a moveRequest, find a new scoutTarget

        if (!creep.moveRequest) delete creep.memory.scoutTarget
    }
}

Scout.prototype.findScoutTarget = function () {
    if (this.memory.scoutTarget) return true

    const commune = Game.rooms[this.memory.commune]

    // Construct storage of exit information

    const scoutedRooms: string[] = []
    const unscoutedRooms: string[] = []

    // Get information about the room's exits

    const exits = Game.map.describeExits(this.room.name)

    // Loop through each exit type

    for (const exitType in exits) {
        // Get the roomName using the exitType

        const roomName = exits[exitType as ExitKey]

        // Iterate if the room statuses aren't the same

        if (Game.map.getRoomStatus(roomName).status !== Game.map.getRoomStatus(this.room.name).status) continue

        // If a scout already has this room as a target

        if (commune.scoutTargets.has(roomName)) continue

        // If the room has memory and a lastScout

        if (Memory.rooms[roomName] && Memory.rooms[roomName].lastScout) {
            // Add it to scoutedRooms and iterate

            scoutedRooms.push(roomName)
            continue
        }

        // Otherwise add it to unscouted rooms

        unscoutedRooms.push(roomName)
    }

    const scoutTarget = unscoutedRooms.length
        ? unscoutedRooms.sort(
              (a, b) =>
                  Game.map.getRoomLinearDistance(this.memory.commune, a) -
                  Game.map.getRoomLinearDistance(this.memory.commune, b),
          )[0]
        : scoutedRooms.sort((a, b) => Memory.rooms[a].lastScout - Memory.rooms[b].lastScout)[0]

    if (!scoutTarget) return false

    this.memory.scoutTarget = scoutTarget
    commune.scoutTargets.add(scoutTarget)

    return true
}

Scout.prototype.recordDeposits = function () {
    const { room } = this

    if (room.memory.type != 'highway') return

    // Make sure the room has a commune

    if (room.memory.commune) {
        if (!Memory.communes.includes(room.memory.commune)) {
            room.memory.commune = findClosestCommuneName(room.name)
        }
    } else {
        room.memory.commune = findClosestCommuneName(room.name)
    }

    const communeMemory = Memory.rooms[room.memory.commune]

    const deposits = room.find(FIND_DEPOSITS)

    // Filter deposits that haven't been assigned a commune and are viable

    const unAssignedDeposits = deposits.filter(function (deposit) {
        return !communeMemory.deposits[deposit.id] && deposit.lastCooldown <= 100 && deposit.ticksToDecay > 500
    })

    for (const deposit of unAssignedDeposits)
        communeMemory.deposits[deposit.id] = {
            decay: deposit.ticksToDecay,
            needs: [1, 1],
        }
}

Scout.prototype.advancedSignController = function () {
    const { room } = this

    if (!room.controller) return true

    // Construct the signMessage

    let signMessage: string

    // If the room is owned by an enemy or an ally

    if (room.memory.type === 'ally' || room.memory.type === 'enemy') return true

    if (room.controller.reservation && room.controller.reservation.username != Memory.me) return true

    // If the room is a commune

    if (room.memory.type === 'commune') {
        // If the room already has a correct sign

        if (room.controller.sign && communeSigns.includes(room.controller.sign.text)) return true

        // Otherwise assign the signMessage the commune sign

        signMessage = communeSigns[0]
    }

    // Otherwise if the room is not a commune
    else {
        // If the room already has a correct sign

        if (room.controller.sign && nonCommuneSigns.includes(room.controller.sign.text)) return true

        // And assign the message according to the index of randomSign

        signMessage = nonCommuneSigns[Math.floor(Math.random() * nonCommuneSigns.length)]
    }

    // If the controller is not in range

    if (this.pos.getRangeTo(room.controller.pos) > 1) {
        // Request to move to the controller and inform false

        this.createMoveRequest({
            origin: this.pos,
            goal: { pos: room.controller.pos, range: 1 },
            avoidEnemyRanges: true,
            plainCost: 1,
            swampCost: 1,
        })

        if (!this.moveRequest) return true

        return false
    }

    // Otherwise Try to sign the controller, informing the result

    this.signController(room.controller, signMessage)
    return true
}