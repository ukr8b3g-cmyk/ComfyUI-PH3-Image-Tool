// The caller owns the once-per-dialog prompt; no download without a positive answer.
export async function ensureCutoutModel({client,catalog,confirmDownload,onStatus,tr}){
 if(catalog.cutout?.model_available)return true;
 if(!catalog.cutout?.onnx_available)return false;
 if(!await confirmDownload(tr('isnetDownloadConfirm')))return false;
 onStatus(tr('isnetDownloading'));
 let result;
 try{result=await client.post('/cutout/model/download',{confirmed:true});}
 catch(error){if(/404|not found/i.test(error.message))throw Error(tr('isnetRestart'));throw error;}
 if(!result.model_available)throw Error(tr('isnetDownloadFailed'));
 catalog.cutout.model_available=true;onStatus(tr('isnetDownloadReady'));return true;
}
