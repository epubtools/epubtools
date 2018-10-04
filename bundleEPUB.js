
const archiver  = require('archiver');
const xmldom    = require('xmldom');
const utils     = require('./utils');
const fs        = require('fs-extra');
const path      = require('path');
const globfs    = require('globfs');
const metadata  = require('./metadata');
const opf       = require('./opf');

exports.renderEPUB = async function(config) {
    let rootDir = path.join(path.dirname(config.configFileName),
                        config.sourceBookroot);
    let destDir = path.join(path.dirname(config.configFileName),
                        config.destRenderRoot)
    return await globfs.copyAsync(rootDir,
        [ "**/*", '**/.*/*', '**/.*' ],
        destDir);
};

exports.bundleEPUB = async function(config) {
    // read container.xml -- extract OPF file name
    // read OPF file
    // write mimetype file
    // write container.xml
    // write OPF file
    // for each entry in OPF - write that file
    // when done, finalize

    // console.log(`bundleEPUB configFileName = ${config.configFileName}`); 
    // console.log(`bundleEPUB configDir = ${path.dirname(config.configFileName)}`);
    let destDir = path.join(config.configDirPath, 
                        config.sourceBookroot);
    // console.log(`bundleEPUB destDir = ${destDir}`);

    await exports.mkMimeType(config);
    await exports.mkMetaInfDir(config);
    await exports.mkContainerXmlFile(config);
    await exports.mkPackageOPF(config);
    
    await archiveFiles(config);
};

async function archiveFiles(config) {

    console.log(`archiveFiles`);
    const rendered = path.join(config.configDirPath, config.sourceBookroot);
    const epubFileName = path.join(config.configDirPath, config.epubFileName);
    const opfFileName = config.sourceBookOPF;
    console.log(`archiveFiles reading OPF config.sourceBookFullPath ${config.sourceBookFullPath} opfFileName ${opfFileName}`);
    const { 
        opfXmlText, opfXml 
    } = await metadata.readOPF(config.sourceBookFullPath, opfFileName); 
    
    console.log(`archiveFiles rendered ${rendered} epubFileName ${epubFileName} opfFileName ${opfFileName}`);

    const opfDirName = path.dirname(opfFileName);

    return new Promise((resolve, reject) => {
        try {
            var archive = archiver('zip');
            
            var output = fs.createWriteStream(epubFileName);
                    
            output.on('close', () => {
                // logger.info(archive.pointer() + ' total bytes');
                // logger.info('archiver has been finalized and the output file descriptor has closed.');
                resolve();
            });
            
            archive.on('error', err => {
                // logger.info('*********** BundleEPUB ERROR '+ err);
                reject(err);
            });
            
            archive.pipe(output);
            
            // The mimetype file must be the first entry, and must not be compressed
            console.log(`reading ${path.join(rendered, "mimetype")} into archive`);
            archive.append(
                fs.createReadStream(path.join(rendered, "mimetype")),
                { name: "mimetype", store: true });
            archive.append(
                fs.createReadStream(path.join(rendered, "META-INF", "container.xml")),
                { name: path.join("META-INF", "container.xml") });
            archive.append(
                fs.createReadStream(path.join(rendered, opfFileName)),
                { name: opfFileName });
            
            var manifests = opfXml.getElementsByTagName("manifest");
            var manifest;
            for (let elem of utils.nodeListIterator(manifests)) {
                if (elem.nodeName.toUpperCase() === 'manifest'.toUpperCase()) manifest = elem;
            }
            if (manifest) {
                var items = manifest.getElementsByTagName('item');
                for (let item of utils.nodeListIterator(items)) {
                    if (item.nodeName.toUpperCase() === 'item'.toUpperCase()) {
                        var itemHref = item.getAttribute('href');
                        
                        if (itemHref === "mimetype"
                         || itemHref === opfFileName
                         || itemHref === path.join("META-INF", "container.xml")) {
                            // Skip these special files
                            continue;
                        }
                        
                        archive.append(
                            fs.createReadStream(path.join(rendered, opfDirName, itemHref)),
                            { name: path.normalize(path.join(opfDirName, itemHref)) }
                        );
                    }
                }
            }
            
            archive.finalize();

        } catch(e) { reject(e); }
    });

}

exports.mkMimeType = async function(config) {
    console.log(`writing ${path.join(config.sourceBookFullPath, "mimetype")}`);
    await fs.writeFile(
        path.join(config.sourceBookFullPath, "mimetype"),
        "application/epub+zip", "utf8");
};

exports.mkMetaInfDir = async function(config) {
    console.log(`mkMetaInfDir ${path.join(config.sourceBookFullPath, "META-INF")}`);
    await fs.mkdirs(path.join(
                    config.sourceBookFullPath, "META-INF"));
};

exports.mkPackageOPF = async function(config) {
    console.log(`mkPackageOPF ${path.join(config.sourceBookFullPath, config.sourceBookOPF)}`);
    const OPFXML = await opf.makeOpfXml(config);

    await fs.writeFile(
        path.join(config.sourceBookFullPath, config.sourceBookOPF),
        new xmldom.XMLSerializer().serializeToString(OPFXML), 
        "utf8");

};

exports.mkContainerXmlFile = async function(config) {
    
    // util.log('createContainerXmlFile '+ rendered +' '+ util.inspect(bookYaml));
    
    var containerXml = new xmldom.DOMParser().parseFromString(
        `<?xml 
                version="1.0" 
                encoding="utf-8" 
                standalone="no"?>
        <container 
                xmlns="urn:oasis:names:tc:opendocument:xmlns:container" 
                version="1.0">
    	<rootfiles> </rootfiles>
        </container>
    `, 'text/xml');
    	
    	
    //	<%
    //    rootfiles.forEach(function(rf) {
    //    %>
    //    <rootfile full-path="<%= rf.path %>" media-type="<%= rf.type %>"/><%
    //    });
    //    %>
    	
    var rootfiles = containerXml.getElementsByTagName("rootfiles");
    var rfs;
    var elem;
    // util.log(util.inspect(rootfile));
    for (var rfnum = 0; rfnum < rootfiles.length; rfnum++) {
        elem = rootfiles.item(rfnum);
        if (elem.nodeName.toUpperCase() === 'rootfiles'.toUpperCase()) rfs = elem;
    }
    
    elem = containerXml.createElement('rootfile');
    elem.setAttribute('full-path', config.sourceBookOPF);
    elem.setAttribute('media-type', 'application/oebps-package+xml');
    rfs.appendChild(elem);
    
    await exports.mkMetaInfDir(config);
    console.log(`mkContainerXmlFile ${path.join(config.sourceBookFullPath, "META-INF", "container.xml")}`);
    await fs.writeFile(
            path.join(config.sourceBookFullPath, "META-INF", "container.xml"),
            new xmldom.XMLSerializer().serializeToString(containerXml), 
            "utf8");
};
