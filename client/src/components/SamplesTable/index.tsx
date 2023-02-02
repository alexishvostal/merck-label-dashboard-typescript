import { useSelector } from "react-redux";
import { useEffect, useState } from "react";

import { 
    DataGrid, 
    GridColDef, 
    GridRowId, 
    GridToolbar, 
    GridToolbarContainer 
} from "@mui/x-data-grid";
import { Button } from "@mui/material";
import { 
    Delete, 
    NoteAdd, 
    Refresh,
    History
} from "@mui/icons-material";

import { DateTime } from "luxon";

import * as api from "../../api";
import { State, useActionCreators } from "../../redux";

import "./styles.css"
import { Link } from "react-router-dom";

interface SamplesTableToolbarProps {
    selectedSamples: api.Sample[];
}

const SamplesTableToolbar: React.FC<SamplesTableToolbarProps> = ({
    selectedSamples
}) => {

    const team = useSelector((state: State) => state.team);
    const {
        fetchTeamsSamples,
        deleteSample
    } = useActionCreators();

    return (
        <GridToolbarContainer>
            <GridToolbar />
            
            <Button 
                startIcon={<NoteAdd />} 
                disabled={selectedSamples.length == 0} 
                // onClick={onGenerateLabelsClick}
            >
                Generate Label(s)
            </Button>

            <Button 
                startIcon={<Delete />} 
                disabled={selectedSamples.length == 0} 
                onClick={() => { 
                    for (const sample of selectedSamples) {
                        deleteSample(sample.id);
                    }
                }}
            >
                Delete Sample(s)
            </Button>
            
            <Button 
                startIcon={<History />} 
                disabled={selectedSamples.length != 1}
            >
                <Link
                    to={`/samples/audit/${selectedSamples[0]?.id!}`}
                    style={{textDecoration: 'none', color: 'inherit'}}
                >
                    View Audit Table    
                </Link>
            </Button>

            <Button 
                startIcon={<Refresh />} 
                onClick={() => fetchTeamsSamples(team)}
            >
                Refresh Samples
            </Button>
        </GridToolbarContainer>
    )
}

const constantGridColumns: GridColDef[] = [
    { 
        field: "id", 
        headerName: "ID", 
        width: 150,
        editable: false
    },
    { 
        field: "date_created", 
        headerName: "Date Created", 
        flex: 0.6,
        type: "date",
        editable: false,
        valueGetter(params) {
            return DateTime.fromISO(params.value as string).toFormat("MM/dd/yyyy");
        },
    },
    { 
        field: "date_modified", 
        headerName: "Date Modified", 
        flex: 0.6,
        type: "date",
        editable: false,
        valueGetter(params) {
            return DateTime.fromISO(params.value as string).toFormat("MM/dd/yyyy");
        },
    },
    { 
        field: "expiration_date", 
        headerName: "Expiration Date", 
        flex: 0.6,
        type: "date",
        editable: true,
        valueGetter(params) {
            return DateTime.fromISO(params.value as string).toFormat("MM/dd/yyyy");
        },
        valueParser(value, params) {
            if (params === undefined) return;
            const date = DateTime.fromJSDate(value).toISO();
            params.row.date_created = date;
            return date;
        }
    },
];

const SamplesTable: React.FC = () => {
    
    const { team, samples, fields } = useSelector((state: State) => { 
        return {
            team: state.team,
            samples: state.samples,
            fields: state.fields
        }
    });

    const { 
        fetchAllSamples,
        fetchAllFields,
        fetchTeamsSamples,
        fetchTeamsFields,
        updateSample,
     } = useActionCreators();

    useEffect(() => {
        if (team === undefined || team === '') {
            fetchAllSamples();
            fetchAllFields();
        } else {
            fetchTeamsSamples(team);
            fetchTeamsFields(team);
        }
    }, []);

    useEffect(() => {
        if ((team === undefined || team === '') || (fields === undefined || fields[team] === undefined)) 
            return;
        generateDynamicGridColDefs();
    }, [team, fields]);

    const [dynamicGridColDefs, setDynamicGridColDefs] = useState<GridColDef[]>([]);

    /**
     * This is going to need some explanation.
     * From my understanding the material ui data grid stores the data that we pass
     * into the rows prop on their end. And since some of our data is nested in the
     * data object, we need to use the valueGetter prop to access the data. On the
     * other hand we need to use the valueParser prop to set the data. This is mainly 
     * because dates are annoying and we need to convert them to ISO strings for prisma
     * but material ui accepts JS dates or formatted dates (MM/dd/yyyy). The valueGetter returns
     * the render value and the valueParser returns the value that is stored in the data/rows object
     * stored on material uis end.
     * @returns 
     */
    const generateDynamicGridColDefs = () => {
        const dynamicGridColDefs: GridColDef[] = [];

        if ((team === undefined || team === '') || (fields === undefined || fields[team] === undefined)) 
            return setDynamicGridColDefs(dynamicGridColDefs);
        
        for (const field of fields[team]) {
            dynamicGridColDefs.push({
                field: field.name,
                headerName: field.display_name,
                flex: 1.0,
                editable: true,
                type: field.name.includes("date") ? "date" : "string",
                valueGetter(params) {
                    if (field.name.includes("date")) { 
                        if (params.row.data[field.name] === undefined) {
                            params.row.data[field.name] = DateTime.now().toISO();
                            return DateTime.now().toFormat("MM/dd/yyyy");
                        }
                        return DateTime.fromISO(params.row.data[field.name]).toFormat("MM/dd/yyyy");
                    }
                    return params.row.data[field.name] ?? "N/A";
                },
                valueParser(value, params) {
                    if (params !== undefined) {
                        if (field.name.includes("date")) {
                            const date = DateTime.fromJSDate(value); 
                            params.row.data[field.name] = date.toISO();
                        } else {
                            params.row.data[field.name] = value;
                        }
                        return params.row.data[field.name];
                    }
                },
            })
        }

        setDynamicGridColDefs(dynamicGridColDefs);
    }

    const [selectedSamples, setSelectedSamples] = useState<api.Sample[]>([]);

    const onSelectionChange = (newSelection: GridRowId[]) => {
        const newSelectedSamples: api.Sample[] = [];
        for (const sample of samples[team] ?? []) {
            if (newSelection.includes(sample.id)) {
                newSelectedSamples.push(sample);
            }
        }
        setSelectedSamples(newSelectedSamples);
    }

    const [itemsPerPage, setItemsPerPage] = useState(10);

    type DataGridSampleType = {
        [key in keyof api.Sample]: string | number | Record<string, any>;
    };

    /**
     * Normally you would just pass the newData object to the updateSample function
     * but prisma is not expecting the updated sample to have an id, audit_id, or audit_number
     * which is currently stored in the newData object. So we need to construct a new sample
     * object without those fields. Also when a row is modified material ui will add the modified value to its internal
     * rows object as row[key] = value. But we need to store the modified value in row.data[key].
     * So if we detect that the newData object has a key that is not in the oldData object
     * we know that the value was modified once resided in the data key of the old data object
     *  and we need to move it to the data object of newData.
     */
    const onRowUpdate = (newData: DataGridSampleType, oldData: DataGridSampleType) => {
        const newSampleData: api.UpdateSampleRequirements = {
            expiration_date: DateTime.fromISO(newData.expiration_date as string),
            date_created: DateTime.fromISO(newData.date_created as string),
            date_modified: DateTime.fromISO(newData.date_modified as string),
            team_name: team,
            data: {}
        }

        for (const field of fields[team]) {
            if (!oldData.hasOwnProperty(field.name) && newData[field.name] !== undefined) {
                newData.data[field.name] = newData[field.name];
                delete newData[field.name];
            }
        }

        newSampleData.data = newData.data as Record<string, any>;
        updateSample(oldData.id as string, newSampleData);
        return newData;
    }

    const columns = [
        constantGridColumns[0], // ID comes first
        ...dynamicGridColDefs, // Dynamic columns
        ...constantGridColumns.slice(1), // Rest of the columns (the 3 dates)
    ]

    const rows = samples[team] ?? [];

    return (
        <>
            <div
                className="data-grid-container"
            >
                <DataGrid
                    className="data-grid"
                    experimentalFeatures={{ newEditingApi: true }}
                    rows={rows}
                    columns={columns}
                    onSelectionModelChange={onSelectionChange}
                    processRowUpdate={(newRow: DataGridSampleType, oldRow: DataGridSampleType) => onRowUpdate(newRow, oldRow)}
                    pageSize={itemsPerPage}
                    rowsPerPageOptions={[5, 10, 25, 50, 100]}
                    onPageSizeChange={(pageSize) => setItemsPerPage(pageSize)}
                    isCellEditable={(params) => params.field !== "id" && params.field !== "date_created" && params.field !== "date_modified"}
                    components={{
                        Toolbar: SamplesTableToolbar
                    }}
                    componentsProps={{
                        toolbar: { selectedSamples }
                    }}
                    checkboxSelection
                    disableSelectionOnClick
                />
            </div>
        </>
    );

}

export default SamplesTable;