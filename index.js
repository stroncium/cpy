'use strict';
const EventEmitter = require('events');
const path = require('path');
const arrify = require('arrify');
const globby = require('globby');
const cpFile = require('cp-file');
const CpyError = require('./cpy-error');

const preprocessSourcePath = (source, options) => options.cwd ? path.resolve(options.cwd, source) : source;

const preprocessDestinationPath = (source, destination, options) => {
	let basename = path.basename(source);
	const dirname = path.dirname(source);

	if (typeof options.rename === 'string') {
		basename = options.rename;
	} else if (typeof options.rename === 'function') {
		basename = options.rename(basename);
	}

	if (options.cwd) {
		destination = path.resolve(options.cwd, destination);
	}

	if (options.parents) {
		return path.join(destination, dirname, basename);
	}

	return path.join(destination, basename);
};

module.exports = (source, destination, options = {}) => {
	const progressEmitter = new EventEmitter();

	const promise = (async () => {
		source = arrify(source);

		if (source.length === 0 || !destination) {
			throw new CpyError('`source` and `destination` required');
		}

		const copyStatus = new Map();
		let completedFiles = 0;
		let completedSize = 0;

		let files;
		try {
			files = await globby(source, options);
		} catch (error) {
			throw new CpyError(`Cannot glob \`${source}\`: ${error.message}`, error);
		}

		if (files.length === 0) {
			progressEmitter.emit('progress', {
				totalFiles: 0,
				percent: 1,
				completedFiles: 0,
				completedSize: 0
			});
		}

		const fileProgressHandler = event => {
			const fileStatus = copyStatus.get(event.src) || {written: 0, percent: 0};

			if (fileStatus.written !== event.written || fileStatus.percent !== event.percent) {
				completedSize -= fileStatus.written;
				completedSize += event.written;

				if (event.percent === 1 && fileStatus.percent !== 1) {
					completedFiles++;
				}

				copyStatus.set(event.src, {
					written: event.written,
					percent: event.percent
				});

				progressEmitter.emit('progress', {
					totalFiles: files.length,
					percent: completedFiles / files.length,
					completedFiles,
					completedSize
				});
			}
		};

		return Promise.all(files.map(async sourcePath => {
			const from = preprocessSourcePath(sourcePath, options);
			const to = preprocessDestinationPath(sourcePath, destination, options);

			try {
				await cpFile(from, to, options).on('progress', fileProgressHandler);
			} catch (error) {
				throw new CpyError(`Cannot copy from \`${from}\` to \`${to}\`: ${error.message}`, error);
			}

			return to;
		}));
	})();

	promise.on = (...arguments_) => {
		progressEmitter.on(...arguments_);
		return promise;
	};

	return promise;
};
