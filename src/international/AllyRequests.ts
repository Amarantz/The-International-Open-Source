import { collectiveManager } from './collective'
import { customColors, maxSegmentsOpen } from './constants'
import { customLog, errorLog } from '../utils/utils'

export enum AllyRequestTypes {
    /**
     * Tell allies to send below a certain amount of resources a room
     */
    resource,
    /**
     * Tell allies to defend a room
     */
    defense,
    /**
     * Tell allies to attack a room
     */
    attack,
    /**
     * No support from this code, I have no clue what this is for
     */
    execute,
    /**
     * Tell allies they should hate a player a specific amount
     */
    hate,
    /**
     * No support from this code, I strongly suggest utilizing resource requests for this cause
     */
    funnel,
    /**
     * Request help in building a room's structures
     */
    build,
}
export const allyRequestTypeKeys = Object.keys(
    AllyRequestTypes,
) as unknown as (keyof typeof AllyRequestTypes)[]

export interface AllyRequest {
    /**
     * Added to ally requests when organizing them for response
     */
    ID?: string
    requestType: AllyRequestTypes
    roomName?: string
    playerName?: string
    resourceType?: ResourceConstant
    maxAmount?: number
    /**
     * A number representing the need of the request, where 1 is highest and 0 is lowest
     */
    priority: number
    /**
     * The minimum amount of damage a squad needs
     */
    minDamage?: number
    /**
     * The minimum amount of heal a ranged squad needs
     */
    minRangedHeal?: number
    /**
     * The minimum amount of heal a melee squad needs
     */
    minMeleeHeal?: number
    /**
     * How much hate to increase or decrease a player by
     */
    hateAmount?: number
}

export interface CreepCombatData {
    meleeDamage: number
    rangedDamage: number
    heal: number
    hits: number
    defence: number
}

/**
 * Contains functions and methods useful for ally trading. Ensure allyTrading in Memory is enabled, as well as no other values or in the designated allySegmentID before usage
 */
class AllyRequestManager {
    /**
     * Intra tick requests we intend to send to our allies
     */
    myRequests: AllyRequest[]
    /**
     * The ally we are sending requests to this tick
     */
    currentAlly: string

    /**
     * To call before any requests are made. Configures some required values
     */
    initRun() {
        this.myRequests = []

        if (!global.settings.allyTrading) return
        if (!global.settings.allies.length) return

        this.currentAlly = global.settings.allies[Game.time % global.settings.allies.length]

        const nextAllyName = global.settings.allies[(Game.time + 1) % global.settings.allies.length]
        RawMemory.setActiveForeignSegment(nextAllyName, global.settings.allySegmentID)
    }

    /**
     * To call after requests have been made, to assign requests to the next ally
     */
    endRun() {
        if (!global.settings.allyTrading) return
        if (!global.settings.allies.length) return
        if (!this.myRequests.length) return // Debug
        // Make sure we don't have too many segments open
        if (Object.keys(RawMemory.segments).length >= maxSegmentsOpen) {
            throw Error('Too many segments open: AllyRequestManager')
        }

        const newSegmentData = (collectiveManager.myAllyRequestData =
            collectiveManager.myAllyRequestData.concat(this.myRequests))
        customLog('Added data to requests')
        // Assign my requests publically for my allies to read
        RawMemory.segments[global.settings.allySegmentID] = JSON.stringify(newSegmentData)
        RawMemory.setPublicSegments([global.settings.allySegmentID])
    }

    requestAttack(
        roomName: string,
        playerName: string,
        minDamage: number = 0,
        minMeleeHeal: number = 0,
        minRangedHeal: number = 0,
        priority: number = 0,
    ) {
        this.myRequests.push({
            requestType: AllyRequestTypes.attack,
            roomName,
            playerName,
            minDamage,
            minMeleeHeal,
            minRangedHeal,
            priority,
        })
    }

    requestDefense(
        roomName: string,
        minDamage: number = 0,
        minMeleeHeal: number = 0,
        minRangedHeal: number = 0,
        priority: number = 0,
    ) {
        this.myRequests.push({
            requestType: AllyRequestTypes.defense,
            roomName,
            minDamage,
            minMeleeHeal,
            minRangedHeal,
            priority,
        })
    }

    requestHate(playerName: string, hateAmount: number, priority: number = 0) {
        this.myRequests.push({
            requestType: AllyRequestTypes.hate,
            playerName,
            hateAmount,
            priority,
        })
    }

    requestResource(
        roomName: string,
        resourceType: ResourceConstant,
        maxAmount: number,
        priority: number = 0,
    ) {
        this.myRequests.push({
            requestType: AllyRequestTypes.resource,
            resourceType,
            maxAmount,
            roomName,
            priority,
        })
    }

    requestBuild(roomName: string, priority: number = 0) {
        this.myRequests.push({
            requestType: AllyRequestTypes.build,
            roomName,
            priority,
        })
    }

    _allyRequests: Partial<Record<keyof typeof AllyRequestTypes, { [ID: string]: AllyRequest }>>
    get allyRequests() {
        if (this._allyRequests) return this._allyRequests

        this._allyRequests = {}
        for (const key in AllyRequestTypes)
            this._allyRequests[key as keyof typeof AllyRequestTypes] = {}

        if (!RawMemory.foreignSegment) return this._allyRequests
        if (RawMemory.foreignSegment.username !== this.currentAlly) return this._allyRequests

        let rawAllyRequests: AllyRequest[]

        try {
            rawAllyRequests = JSON.parse(RawMemory.foreignSegment.data)
        } catch (err) {
            errorLog('Error in getting requests for simpleAllies', this.currentAlly)
        }

        // Organize requests by type with keys of ID

        for (const request of rawAllyRequests) {
            if (!AllyRequestTypes[request.requestType]) {
                errorLog(
                    'AllyRequestManager',
                    `Improper request, no type has been assigned. Request is from ${this.currentAlly}`,
                )
                continue
            }

            const ID = collectiveManager.newTickID()
            request.ID = ID

            this._allyRequests[allyRequestTypeKeys[request.requestType]][ID] = request
        }

        return this._allyRequests
    }
}

export const allyRequestManager = new AllyRequestManager()