import React, { useState } from 'react'
import { observer } from 'mobx-react'
import {
  Link,
  IconButton,
  Typography,
  Button,
  makeStyles,
} from '@material-ui/core'
import { DataGrid, GridCellParams } from '@mui/x-data-grid'
import { 
  getSession, 
  parseLocString, 
  when, 
  assembleLocString, 
  measureText } from '@jbrowse/core/util'
import DeleteIcon from '@material-ui/icons/Delete'
import ViewCompactIcon from '@material-ui/icons/ViewCompact'
import { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'
import { AbstractViewModel } from '@jbrowse/core/util/types'

import { FlashmapResultsModel } from '../model'
import { NavigableViewModel } from '../types'

const useStyles = makeStyles(() => ({
  link: {
    cursor: 'pointer',
  },
}))

async function navToMappedRegion(
  locString: string,
  views: AbstractViewModel[],
  model: FlashmapResultsModel,
) {
  const { selectedAssembly } = model
  const lgv = views.find(
    view =>
      view.type === 'LinearGenomeView' &&
      // @ts-ignore
      view.assemblyNames[0] === selectedAssembly,
  ) as NavigableViewModel

  if (lgv) {
    lgv.navToLocString(locString)
  } else {
    const session = getSession(model)
    const { assemblyManager } = session
    const assembly = await assemblyManager.waitForAssembly(selectedAssembly)
    if (assembly) {
      try {
        const loc = parseLocString(locString, refName =>
          session.assemblyManager.isValidRefName(refName, selectedAssembly),
        )
        const { refName } = loc
        const { regions } = assembly
        const canonicalRefName = assembly.getCanonicalRefName(refName)

        let newDisplayedRegion
        if (regions) {
          newDisplayedRegion = regions.find(
            region => region.refName === canonicalRefName,
          )
        }

        const view = session.addView('LinearGenomeView', {
          displayName: selectedAssembly,
        }) as LinearGenomeViewModel
        await when(() => view.initialized)

        view.setDisplayedRegions([
          JSON.parse(JSON.stringify(newDisplayedRegion)),
        ])
        view.navToLocString(locString)
      } catch (e) {
        session.notify(`${e}`, 'error')
      }
    }
  }
}

// creates a coarse measurement of column width, similar to code in
// BaseFeatureDetails
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const measure = (row: any, col: string) =>
  Math.min(Math.max(measureText(String(row[col]), 14) + 20, 80), 1000)

const FlashmapResultsGrid = observer(
  ({ model }: { model: FlashmapResultsModel }) => {
    const classes = useStyles()
    const [dialogRowNumber, setDialogRowNumber] = useState<number>()
    const { mappedRegions, selectedAssembly } = model
    const { views } = getSession(model)

    for (const region of mappedRegions) {
      
    }

    const flashmapResultsRows = mappedRegions
      .toJS()
      .map((region, index) => {
        const { id, queryStart, queryEnd, strand, refName, start, end, score  } = region
        return {
          ...region,
          id: index,
          queryName: 'Query number ' + id.toString(),
          queryStart: queryStart,
          queryEnd: queryEnd,
          strand: strand,
          locString: assembleLocString({refName, start, end}),
          score: score,
        }
      })

    const columns = [
      {
        field: 'queryName',
        headerName: 'Query',
        width: Math.max(
          100,
          Math.max(...flashmapResultsRows.map(row => measure(row, 'queryName'))),
        ),
      },
      {
        field: 'queryStart',
        headerName: 'Query Start',
        width: Math.max(
          100,
          Math.max(...flashmapResultsRows.map(row => measure(row, 'queryName'))),
        ),
      },
      {
        field: 'queryEnd',
        headerName: 'Query End',
        width: Math.max(
          100,
          Math.max(...flashmapResultsRows.map(row => measure(row, 'queryName'))),
        ),
      },
      {
        field: 'strand',
        headerName: 'Strand',
        width: Math.max(
          100,
          Math.max(...flashmapResultsRows.map(row => measure(row, 'queryName'))),
        ),
      },
      {
        field: 'locString',
        headerName: 'Mapped To',
        width: Math.max(...flashmapResultsRows.map(row => measure(row, 'locString'))),
        renderCell: (params: GridCellParams) => {
          const { value } = params
          console.log(params)
          return (
            <Link
              className={classes.link}
              onClick={() => navToMappedRegion(value as string, views, model)}
            >
              {value}
            </Link>
          )
        },
      },
      {
        field: 'score',
        headerName: 'Score',
        width: Math.max(
          100,
          Math.max(...flashmapResultsRows.map(row => measure(row, 'score'))),
        ),
      },
    ]

    return (
      <>
        <DataGrid
          rows={flashmapResultsRows}
          rowHeight={undefined}
          headerHeight={undefined}
          columns={columns}
          disableSelectionOnClick
        />
      </>
    )
  },
)

function FlashmapResultsWidget({ model }: { model: FlashmapResultsModel }) {
  const { selectedAssembly } = model

  return (
    <>
      <div style={{ margin: 12 }}>
        <Typography>
          Click on each bin to perform a refined search.
        </Typography>
      </div>
      <div style={{ height: 750, width: '100%' }}>
        <FlashmapResultsGrid model={model} />
      </div>
    </>
  )
}

export default observer(FlashmapResultsWidget)
