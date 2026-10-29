import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';

// Formatter fixture discovery shared by the plain Node unit tests and the
// Extension Host suite. Every input file needs exactly one expected file.

export interface FormatterFixture {
    name: string;
    input: string;
    expected: string;
}

const inputSuffix = '.input.lpc';
const expectedSuffix = '.expected.lpc';

export const fixtureDirectory = path.resolve(__dirname, '../../src/test/fixtures/formatter');

export function normalizeLineEndings(content: string): string {
    return content.replace(/\r\n?/g, '\n');
}

export async function loadFormatterFixtures(): Promise<FormatterFixture[]> {
    const entries = await fs.readdir(fixtureDirectory, { withFileTypes: true });
    const fileNames = entries
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .sort();
    const fixtureNames = fileNames
        .filter(fileName => fileName.endsWith(inputSuffix))
        .map(fileName => fileName.slice(0, -inputSuffix.length));

    assert.ok(fixtureNames.length > 0, `No formatter fixtures found in ${fixtureDirectory}.`);

    const expectedFixtureNames = fileNames
        .filter(fileName => fileName.endsWith(expectedSuffix))
        .map(fileName => fileName.slice(0, -expectedSuffix.length));
    assert.deepStrictEqual(
        expectedFixtureNames,
        fixtureNames,
        'Every formatter fixture must have exactly one input and expected file.'
    );

    return Promise.all(fixtureNames.map(async name => {
        const [input, expected] = await Promise.all([
            fs.readFile(path.join(fixtureDirectory, `${name}${inputSuffix}`), 'utf8'),
            fs.readFile(path.join(fixtureDirectory, `${name}${expectedSuffix}`), 'utf8')
        ]);
        return { name, input: normalizeLineEndings(input), expected: normalizeLineEndings(expected) };
    }));
}
