import * as assert from 'assert';
import { loadFormatterFixtures } from '../fixtures';
import { formatDocument } from './formatTestUtils';

export interface FormatterFixtureTest {
    name: string;
    run: () => Promise<void>;
}

export async function loadFormatterFixtureTests(): Promise<FormatterFixtureTest[]> {
    const fixtures = await loadFormatterFixtures();
    return fixtures.map(({ name, input, expected }) => ({
        name: `formats fixture: ${name.replace(/-/g, ' ')}`,
        run: async () => {
            const formatted = await formatDocument(input);
            assert.strictEqual(
                formatted,
                expected,
                `${name}: formatted output did not match the expected file.`
            );
            assert.strictEqual(
                await formatDocument(formatted),
                formatted,
                `${name}: a second formatting pass changed the output.`
            );
        }
    }));
}
