// Identity keys join their parts with NUL. A NUL cannot travel in argv and some
// providers reject it inside request JSON, so the model sees a visible stand-in.
export function childPrompt(prompt: string) {
	return prompt.split("\0").join("␀");
}
