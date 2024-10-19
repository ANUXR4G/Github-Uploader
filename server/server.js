// server/server.js
const express = require('express');
const multer = require('multer');
const { Octokit } = require('@octokit/rest');
const cors = require('cors');
const fs = require('fs').promises;
require('dotenv').config();

const app = express();
app.use(cors());

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Ensure uploads directory exists
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

app.post('/upload', upload.array('files'), async (req, res) => {
    try {
        const { token, repoName } = req.body;
        const files = req.files;

        if (!token || !repoName || !files.length) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Initialize GitHub API client
        const octokit = new Octokit({ auth: token });
        const [owner, repo] = repoName.split('/');

        // Get the default branch
        const { data: repository } = await octokit.repos.get({
            owner,
            repo,
        });
        const defaultBranch = repository.default_branch;

        // Get the latest commit SHA
        const { data: ref } = await octokit.git.getRef({
            owner,
            repo,
            ref: `heads/${defaultBranch}`,
        });
        const latestCommitSha = ref.object.sha;

        // Get the base tree
        const { data: baseTree } = await octokit.git.getTree({
            owner,
            repo,
            tree_sha: latestCommitSha,
        });

        // Create blobs for each file
        const fileBlobs = await Promise.all(
            files.map(async (file) => {
                const content = await fs.readFile(file.path, 'base64');
                const { data } = await octokit.git.createBlob({
                    owner,
                    repo,
                    content,
                    encoding: 'base64',
                });
                return {
                    path: file.originalname,
                    mode: '100644',
                    type: 'blob',
                    sha: data.sha,
                };
            })
        );

        // Create a new tree
        const { data: newTree } = await octokit.git.createTree({
            owner,
            repo,
            base_tree: baseTree.sha,
            tree: fileBlobs,
        });

        // Create a new commit
        const { data: newCommit } = await octokit.git.createCommit({
            owner,
            repo,
            message: 'Upload files via web interface',
            tree: newTree.sha,
            parents: [latestCommitSha],
        });

        // Update the reference
        await octokit.git.updateRef({
            owner,
            repo,
            ref: `heads/${defaultBranch}`,
            sha: newCommit.sha,
        });

        // Clean up uploaded files
        await Promise.all(files.map(file => fs.unlink(file.path)));

        res.json({ message: 'Files uploaded successfully' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});