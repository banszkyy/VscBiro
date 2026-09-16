const xml2js = require('xml2js')
const fs = require('fs')
const path = require('path')

const parser = new xml2js.Parser()
const builder = new xml2js.Builder()

const states = [
    {
        name: 'none',
        color: '#646468',
    },
    {
        name: 'error',
        color: '#E6494A',
    },
    {
        name: 'progress',
        color: '#F6C177',
    },
    {
        name: 'pass',
        color: '#558E6D',
    },
]

for (const element of fs.readdirSync(__dirname, { recursive: false })) {
    if (!element.endsWith('.svg')) continue
    if (states.find(v => element.endsWith(`${v.name}.svg`))) continue

    const fullPath = path.join(__dirname, element)
    parser.parseString(fs.readFileSync(fullPath, 'utf8'), (error, result) => {
        if (error) {
            console.error(error)
            return
        }
        for (const state of states) {
            result['svg']['circle'] = {
                ['$']: {
                    style: `fill:${state.color};fill-opacity:1;stroke-width:432.96;paint-order:stroke markers fill`,
                    cx: "760",
                    cy: "-200",
                    r: "200",
                }
            }
            fs.writeFileSync(`${fullPath.substring(0, fullPath.lastIndexOf('.'))}-${state.name}.svg`, builder.buildObject(result), 'utf8')
        }
    })
}
