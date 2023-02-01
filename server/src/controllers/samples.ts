import { RequestHandler } from "express";
import prisma, { teamIsActive } from "../db";
import { Sample } from "@prisma/client";

/**
 * Base route /:team/samples
 */

// [x] create
// [x] delete
// [x] update
// [x] get all /:team/samples
// [x] get one /:team/samples/:id

// Need to think of a different route for this.
// Currently clashes with get one sample
// [~] get deleted, route: /:team/samples/deleted

// [x] get history, route: /:team/samples/:id/audit

export const getSamples: RequestHandler = async (req, res) => {
    const { id, team } = req.query as { id?: string, team?: string };

    /* Handles the case where have both an id and team. We get the sample with given id from the given team */
    if (id !== undefined && team != undefined) {
        const teamExists = await teamIsActive(team as string);

        if (!teamExists)
            return res.status(404).json({ message: `Team "${team}" not found` });
    
        const sample = await prisma.sample.findFirst({
            where: {
                id,
                team_name: team
            }
        });
    
        if (!sample)
            return res.status(404).json({ message: `Sample "${id}" not found in team "${team}"` });
    
        // If this samples audit id is in the deleted table, then it is deleted
        const isDeleted = await prisma.deleted.findFirst({
            where: {
                audit_id: sample.audit_id
            }
        });
    
        if (isDeleted !== null)
            return res.status(404).json({ message: `Sample "${id}" not found` });
    
        res.status(200).json(sample);
    } 
    /** Handles the case where we only have the id. Searches all teams for the sample with the given id */
    else if (id !== undefined) {
        const sample = await prisma.sample.findUnique({
            where: {
                id: id as string
            }
        });
    
        if (!sample)
            return res.status(404).json({ message: `Sample "${id}" not found in any team` });
    
        // If this samples audit id is in the deleted table, then it is deleted
        const isDeleted = await prisma.deleted.findFirst({
            where: {
                audit_id: sample.audit_id
            }
        });
    
        if (isDeleted !== null)
            return res.status(404).json({ message: `Sample "${id}" not found` });
    
        res.status(200).json(sample);
    } 
    /** Handles the case where only the team is provided. Gets all the samples for the provided team */
    else if (team !== undefined) {
        const teamExists = await teamIsActive(team);

        if (!teamExists) 
            return res.status(404).json({ message: `Team "${team}" not found` });
    
        const deletedAuditIDs = (await prisma.deleted.findMany())
            .filter((group) => group.team_name === team).map((group) => group.audit_id!);
    
        // Now we want to get the newest audit number for each audit id that is not deleted
        const newestNonDeletedSamples = (await prisma.sample.groupBy({
            by: ["audit_id"],
            where: {
                team_name: team,
                audit_id: {
                    notIn: deletedAuditIDs
                }
            },
            _max: {
                audit_number: true
            },
        })).map((group) => { 
            return { 
                audit_id: group.audit_id, 
                audit_number: group._max.audit_number! 
            }
        });
    
        // Now we can get all the newest versions of samples that arent deleted
        const samples = await prisma.sample.findMany({
            where: {
                OR: newestNonDeletedSamples
            }
        });
    
        res.status(200).json(samples);
    } 
    /** Handles the case where no id or team are provided. Returns all samples grouped by team */
    else {
        const deletedAuditIDs = (await prisma.deleted.findMany())
            .map((group) => group.audit_id!);

        const sampleGroups = (await prisma.sample.groupBy({
            by: ["team_name", "audit_id"],
            _max: {
                audit_number: true
            },
        }))
        .filter((group) => !deletedAuditIDs.includes(group.audit_id))
        .map((group) => {
                return {
                    team_name: group.team_name,
                    audit_id: group.audit_id,
                    audit_number: group._max.audit_number!
                }
            }
        );

        const samples = await prisma.sample.findMany({
            where: {
                OR: sampleGroups
            }
        });

        const groupedByTeam: { [key: string]: Sample[] } = {};

        // If a team has no samples it wont show up in the groupedByTeam object
        // But we want it to show up as an empty array so we can show the team exists
        // So we get all teams and initialize their arrays        
        const teams = await prisma.team.findMany();

        for (const team of teams) {
            groupedByTeam[team.name] = [];
        }

        for (const sample of samples) {
            groupedByTeam[sample.team_name].push(sample);
        };

        res.status(200).json(groupedByTeam);
    }
}

export const getAuditTrail: RequestHandler = async (req, res) => {
    const { team, id } = req.params;

    const teamExists = await teamIsActive(team);

    if (!teamExists)
        return res.status(404).json({ message: `Team "${team}" not found` });

    const sample = await prisma.sample.findUnique({
        where: {
            id
        },
        select: {
            audit_id: true
        }
    });

    if (!sample)
        return res.status(404).json({ message: `Sample "${id}" not found` });

    const auditTrail = await prisma.sample.findMany({
        where: {
            audit_id: sample.audit_id
        },
    });

    // Make the highest audit number first (newest)
    auditTrail.sort((a, b) => b.audit_number - a.audit_number);

    res.status(200).json(auditTrail);
}

export const getDeletedSamples: RequestHandler = async (req, res) => {
    const deletedSamples = (await prisma.deleted.findMany())
        .map((del) => del.audit_id);

    const samplesGroups = (await prisma.sample.groupBy({
        by: ["audit_id"],
        where: {
            audit_id: {
                in: deletedSamples
            }
        },
        _max: {
            audit_number: true
        }
    })).map((group) => {
        return {
            audit_id: group.audit_id,
            audit_number: group._max.audit_number!
            }
    });

    const newestDeletedSamples = await prisma.sample.findMany({
        where: {
            OR: samplesGroups
        }
    });

    const teams = await prisma.team.findMany();

    const groupedByTeam: { [key: string]: Sample[] } = {};

    // If a team has no samples it wont show up in the groupedByTeam object
    // But we want it to show up as an empty array so we can show the team exists
    // So we get all teams and initialize their arrays
    for (const team of teams) {
        groupedByTeam[team.name] = [];
    }

    for (const sample of newestDeletedSamples) {
        groupedByTeam[sample.team_name].push(sample);
    };

    res.status(200).json(groupedByTeam);
}

export const createSample: RequestHandler = async (req, res) => {
    const data = req.body;

    const team = data.team_name;

    const teamExists = await teamIsActive(team);

    if (!teamExists) 
        return res.status(404).json({ message: `Team "${team}" not found` });   

    const sample = await prisma.sample.create({
        data
    });

    res.status(201).json(sample);
}

export const updateSample: RequestHandler = async (req, res) => {
    const { id } = req.params;

    const sample = await prisma.sample.findUnique({
        where: {
            id
        }
    });

    if (!sample)
        return res.status(404).json({ message: `Sample "${id}" not found` });

    const isDeleted = await prisma.deleted.findFirst({
        where: {
            audit_id: sample.audit_id
        }
    });

    if (isDeleted !== null)
        return res.status(404).json({ message: `Sample "${id}" not found` });

    const newSampleData = {
        expiration_date: sample.expiration_date,
        team_name: sample.team_name,
        ...req.body,
        data: {
            ...(sample.data as object),
            ...req.body.data
        },
        audit_id: sample.audit_id,
        date_created: sample.date_created
    }

    const newSample = await prisma.sample.create({
        data: newSampleData
    });

    res.status(200).json(newSample);
}

export const deleteSample: RequestHandler = async (req, res) => {
    const { id } = req.params;

    const sample = await prisma.sample.findUnique({
        where: {
            id
        }
    });

    if (!sample)
        return res.status(404).json({ message: `Sample "${id}" not found` });

    const isDeleted = await prisma.deleted.findFirst({
        where: {
            audit_id: sample.audit_id
        }
    });

    if (isDeleted !== null)
        return res.status(404).json({ message: `Sample "${id}" not found` });

    await prisma.deleted.create({
        data: {
            audit_id: sample.audit_id,
            team_name: sample.team_name,
        }
    });

    res.status(200).json(sample);
}