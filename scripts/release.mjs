import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

/**
 * @typedef {{
*   name: string
*   version: string
*   dependencies?: { [dependenciesPackageName: string]: string }
*   peerDependencies?: { [peerDependenciesPackageName: string]: string }
* }} Package
*/

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const packages = fs
    .readdirSync(path.resolve(__dirname, '../packages'))
    .filter(p => {
        const pkgRoot = path.resolve(__dirname, '../packages', p)
        if (fs.statSync(pkgRoot).isDirectory()) {
            const pkg = JSON.parse(
                fs.readFileSync(path.resolve(pkgRoot, 'package.json'), 'utf-8'),
            )
            return !pkg.private
        }
    })

function updateVersions(version) {
    // 1. update root package.json
    updatePackage(path.resolve(__dirname, '..'), version)
    // 2. update all packages
    packages.forEach(p =>
        updatePackage(getPkgRoot(p), version),
    )
    console.log(`Updated all packages to version ${version}`);
}

/**
 * 
 * @param {string} pkg 
 */
function getPkgRoot(pkg) {
    return path.resolve(__dirname, '../packages/' + pkg)
}

/**
 * @param {string} pkgRoot
 * @param {string} version
 */
function updatePackage(pkgRoot, version) {
    const pkgPath = path.resolve(pkgRoot, 'package.json')
    /** @type {Package} */
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    pkg.version = version
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

/**
 * 
 * @param {string} cmd 
 */
async function run(cmd) {
    console.log(`> ${cmd}`)
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout) => {
            if (err) {
                reject(err)
                process.exit(1)
            }
            resolve(stdout)
        })
    })
}

/**
 * 
 * @param {string} version 
 */
async function tag(version) {
    await run(`git add -A`)
    await run(`git commit -m '🐎 ci: release ${version}'`)
    await run(`git tag ${version}`)
    await run(`git push origin refs/tags/${version}`)
    await run(`git push`)
}

async function main() {
    const version = process.argv[2]
    if (!version) {
        console.error('Please provide a version, e.g. `npm run release 1.0.0`')
        process.exit(1)
    }

    console.log(`Releasing ${version}. Confirm?<y/n>`)
    
    process.stdin.on('data', async (data) => {
        if (data.toString().trim() === 'y') {
            updateVersions(version);
            await tag(version);
            console.log('Released ' + version)
        } else {
            console.log('Aborting...')
        }
        process.exit(1)
    })
}

await main()
