import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import { formatDocument } from './formatTestUtils';

export interface FormatterFixtureTest {
    name: string;
    run: () => Promise<void>;
}

const inputSuffix = '.input.lpc';
const expectedSuffix = '.expected.lpc';

function normalizeLineEndings(content: string): string {
    return content.replace(/\r\n?/g, '\n');
}

function fixtureDisplayName(fixtureName: string): string {
    return fixtureName.replace(/-/g, ' ');
}

export async function loadFormatterFixtureTests(): Promise<FormatterFixtureTest[]> {
    const fixtureDirectory = path.resolve(
        __dirname,
        '../../../src/test/fixtures/formatter'
    );
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

    return fixtureNames.map(fixtureName => ({
        name: `formats fixture: ${fixtureDisplayName(fixtureName)}`,
        run: async () => {
            const inputPath = path.join(fixtureDirectory, `${fixtureName}${inputSuffix}`);
            const expectedPath = path.join(fixtureDirectory, `${fixtureName}${expectedSuffix}`);
            const [input, expected] = await Promise.all([
                fs.readFile(inputPath, 'utf8'),
                fs.readFile(expectedPath, 'utf8')
            ]).then(contents => contents.map(normalizeLineEndings));

            const formatted = await formatDocument(input);
            assert.strictEqual(
                formatted,
                expected,
                `${fixtureName}: formatted output did not match the expected file.`
            );
            assert.strictEqual(
                await formatDocument(formatted),
                formatted,
                `${fixtureName}: a second formatting pass changed the output.`
            );
        }
    }));
}
